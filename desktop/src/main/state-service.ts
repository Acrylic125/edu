import { randomUUID } from "node:crypto"
import { z } from "zod"
import { type Topic, type Workspace } from "../shared/contracts"
import { TopicMutationSchema, TopicStateSchema, freshTopicState } from "../shared/topic-state"
import { newTopic, type WorkspaceRepository } from "./workspace"
import { parseTopicDirectory, type TopicDirectoryEntrySchema } from "../shared/topic-directory"
import { materialCitationNames } from "../shared/material-links"

export function applyTopicMutation(workspace: Pick<Workspace, "topics" | "chats">, threadId: string, input: z.infer<typeof TopicMutationSchema>) {
  const { topics } = workspace
  const mutation = TopicMutationSchema.parse(input)
  if (mutation.type === "createTopic") {
    if (topics.some((topic) => topic.id === mutation.topicId)) throw new Error("Topic already exists.")
    const topic = newTopic(mutation.topic.name)
    topic.id = mutation.topicId
    topic.state = TopicStateSchema.parse({ ...mutation.topic, createdAt: topic.createdAt, threadTutors: [{ id: threadId, progress: {} }] })
    attachReferencedMaterials(topic, topic.state, workspace, mutation.materialIds)
    topic.learning.notes = summaryFor(topic.state)
    topics.push(topic)
    return
  }
  const topic = topics.find((topic) => topic.id === mutation.topicId)
  if (!topic) throw new Error("Topic not found.")
  const state = TopicStateSchema.parse(topic.state ?? freshTopicState(topic.title, topic.createdAt))
  let thread = state.threadTutors.find((thread) => thread.id === threadId)
  if (!thread) {
    thread = { id: threadId, progress: {} }
    state.threadTutors.push(thread)
  }
  if (mutation.type === "updateTopic") {
    if (mutation.expectedSummary !== undefined && mutation.expectedSummary !== topic.learning.notes)
      throw new Error("Topic summary changed during this turn. Retry to preserve the latest edits.")
    if (mutation.expectedContent !== undefined && JSON.stringify(mutation.expectedContent) !== JSON.stringify(state.content))
      throw new Error("Topic curriculum changed during this turn. Retry to preserve the latest goals and evidence.")
    if (mutation.name !== undefined) state.name = mutation.name
    if (mutation.content !== undefined) {
      // Curriculum edits retain recorded mistakes; they cannot discard another thread's evidence.
      state.content = mutation.content.map((part) => ({
        ...part,
        mistakes: state.content.find((current) => current.id === part.id)?.mistakes ?? part.mistakes,
      }))
      for (const part of topic.state?.content ?? []) {
        if (part.mistakes.length && !state.content.some((current) => current.id === part.id))
          throw new Error("A part with recorded mistakes cannot be removed.")
      }
    }
    TopicStateSchema.parse(state)
    attachReferencedMaterials(topic, state, workspace, mutation.materialIds)
    topic.title = state.name
    const previousContent = mutation.content === undefined ? undefined : topic.state?.content ?? []
    if (mutation.summary !== undefined) {
      const body = mutation.summary.replace(/^\s*# [^\r\n]*(?:\r?\n|$)/, "").trimStart()
      topic.learning.notes = summaryFor(state, body, previousContent)
    } else {
      const body = topic.learning.notes.replace(/^\s*# [^\r\n]*(?:\r?\n|$)/, "").trimStart()
      if (mutation.content !== undefined) topic.learning.notes = summaryFor(state, body, previousContent)
      else if (!body.trim()) topic.learning.notes = summaryFor(state)
      else if (mutation.name !== undefined) topic.learning.notes = `# ${state.name}\n\n${body}`
    }
    topic.learning.outline = state.content.slice(0, 100).map((part) => part.name)
  } else {
    const part = state.content.find((part) => part.id === mutation.topicPartId)
    if (!part) throw new Error("Topic part not found.")
    const progress = thread.progress[part.id]
    if (mutation.type === "activatePart") {
      thread.progress[part.id] = { status: "active", steps: progress?.steps ?? [] }
    } else if (mutation.type === "complete") {
      if (!progress) throw new Error("Visit and activate the part before completing it.")
      if (mutation.masteryVerified) progress.status = "completed"
      else progress.status = "covered"
    } else if (mutation.type === "documentMistake") {
      part.mistakes.push({ context: mutation.context, issue: mutation.issue })
    } else if (mutation.type === "recordQuestion") {
      if (!progress || progress.status !== "active") throw new Error("Activate the part before asking a question.")
      progress.steps.push({ question: mutation.question })
    } else if (mutation.type === "recordAnswer") {
      const step = progress?.steps[mutation.stepIndex]
      if (!step) throw new Error("Question not found in this thread.")
      if (step.answerFromUser !== undefined) throw new Error("This answer is already recorded. Preserve it and ask a follow-up for another attempt.")
      step.answerFromUser = mutation.answerFromUser
    }
  }
  topic.state = TopicStateSchema.parse(state)
}

function attachReferencedMaterials(topic: Topic, state: z.infer<typeof TopicStateSchema>, workspace: Pick<Workspace, "topics" | "chats">, materialIds?: string[]) {
  const available = [...workspace.topics, ...workspace.chats].flatMap((owner) => owner.materials)
  for (const reference of state.content.flatMap((part) => part.references)) {
    if (reference.type === "website") continue
    if (topic.materials.some((material) => reference.path === `assets/${material.name}`)) continue
    const matches = new Map(available
      .filter((material) => reference.path === `assets/${material.name}` && (!materialIds || materialIds.includes(material.id)))
      .map((material) => [material.id, material]))
    if (matches.size !== 1) throw new Error(`Reference ${reference.path} needs one supplied source. Use materialIds to select it when filenames are ambiguous.`)
    const material = [...matches.values()][0]
    if ((reference.type === "pdf" || reference.type === "ppt") && reference.pages.some((range) => range.to > material.pages.length))
      throw new Error(`Reference pages are outside ${material.name}.`)
    topic.materials.push(material)
  }
}

function summaryFor(state: z.infer<typeof TopicStateSchema>, summary = "", previousContent?: z.infer<typeof TopicStateSchema>["content"]) {
  let body = summary.trim()
  const parsed = parseTopicDirectory(body)
  if (!parsed.directory || previousContent !== undefined) {
    const previous = [...(parsed.directory?.items ?? [])]
    for (const entry of previous) previous.push(...entry.children)
    if (parsed.directory) body = `${parsed.before}${parsed.after}`.trim()
    const entries = (parentId?: string): z.infer<typeof TopicDirectoryEntrySchema>[] =>
      state.content.filter((part) => part.parent?.id === parentId).map((part) => {
        let existing = previous.find((entry) => entry.title === part.name)
        if (!existing) {
          const previousName = previousContent?.find((previous) => previous.id === part.id)?.name
          existing = previous.find((entry) => entry.title === previousName)
        }
        let anchor = existing?.anchor
        if (anchor && !body.includes(`<a id="${anchor}"></a>`)) anchor = undefined
        return {
          title: part.name,
          anchor,
          sources: part.references.map((reference) => {
            if (reference.type === "website") return { label: reference.url, href: reference.url }
            const filename = reference.path.split("/").at(-1) ?? reference.path
            const label = materialCitationNames(filename).at(-1) ?? filename
            if (reference.type === "image" || reference.type === "text") return { label, href: reference.path }
            const pages = reference.pages.map(({ from, to }) => {
              if (from === to) return `${from}`
              return `${from}-${to}`
            }).join(", ")
            return { label: `${label}, pg. ${pages}`, href: `${reference.path}#page=${reference.pages[0].from}` }
          }),
          children: entries(part.id),
        }
      })
    let items = entries()
    if (!items.length) items = [{ title: state.name, sources: [], children: [] }]
    const encoded = JSON.stringify(items).replace(/'/g, "\\u0027")
    body = `<topic-directory heading="Topic directory" items='${encoded}' />\n\n${body}`.trim()
  }
  if (!/^## Topic terminology\s*$/m.test(body)) {
    const terminology = "## Topic terminology\n\n| Term | Meaning / useful distinction |\n|---|---|"
    const materials = /^## Materials\s*$/m.exec(body)
    if (materials) body = `${body.slice(0, materials.index).trimEnd()}\n\n${terminology}\n\n${body.slice(materials.index)}`
    else body += `\n\n${terminology}`
  }
  if (!/^## Materials\s*$/m.test(body)) {
    const sources = [...new Set(state.content.flatMap((part) => part.references.map((reference) => {
      if (reference.type === "website") return `[${reference.url}](${reference.url})`
      return `[${reference.path.split("/").at(-1)}](<${reference.path}>)`
    })))].join("\n\n")
    body += `\n\n## Materials${sources ? `\n\n${sources}` : ""}`
  }
  return `# ${state.name}\n\n${body}`
}

export class StateService {
  constructor(private repository: Pick<WorkspaceRepository, "stateSnapshot" | "mutate">, readonly threadId: string) {}

  private topic(id: string) {
    const topic = this.repository.stateSnapshot.topics.find((topic) => topic.id === id)
    if (!topic) throw new Error("Topic not found.")
    return { topic, state: topic.state ?? freshTopicState(topic.title, topic.createdAt) }
  }

  async getMistakesForTopic(topics: string[] | null) {
    const selected = this.repository.stateSnapshot.topics.filter((topic) => topics === null || topics.includes(topic.id))
    if (topics?.some((id) => !selected.some((topic) => topic.id === id))) throw new Error("Topic not found.")
    return selected.flatMap((topic) => topic.state?.content.flatMap((part) => part.mistakes.map((mistake) => ({ topicId: topic.id, topicName: topic.title, topicPartId: part.id, partName: part.name, ...mistake }))) ?? [])
  }

  async whereAmI(topicId: string) {
    const { state } = this.topic(topicId)
    const thread = state.threadTutors.find((thread) => thread.id === this.threadId)
    return state.content.flatMap((part) => {
      const progress = thread?.progress[part.id]
      if (!progress || progress.status !== "active") return []
      return [{ part, progress }]
    })
  }

  async whatIsNext(topicId: string) {
    const { state } = this.topic(topicId)
    const options = state.threadTutors.flatMap((thread) => state.content.flatMap((part) => {
      const progress = thread.progress[part.id]
      if (!progress || progress.status !== "active") return []
      const question = progress.steps.at(-1)?.question ?? part.name
      return [{ label: `Continue from ${question}`, threadId: thread.id, part, progress }]
    }))
    const next = state.content.find((part) => !state.threadTutors.some((thread) => thread.progress[part.id]))
    if (next) return [...options, { label: `Continue to ${next.name}`, part: next, threadId: null, progress: null }]
    return options
  }

  async getTopicProgress(topicId: string) {
    const { state } = this.topic(topicId)
    return state.content.map((part) => ({
      part,
      threads: state.threadTutors.flatMap((thread) => {
        const progress = thread.progress[part.id]
        if (!progress) return []
        return [{ threadId: thread.id, progress }]
      }),
    }))
  }

  async getQuestions(topicId: string, topicPartId: string) {
    const { state } = this.topic(topicId)
    if (!state.content.some((part) => part.id === topicPartId)) throw new Error("Topic part not found.")
    return state.threadTutors.flatMap((thread) => (thread.progress[topicPartId]?.steps ?? []).map((step, stepIndex) => ({ threadId: thread.id, stepIndex, ...step })))
  }

  async write(mutation: z.infer<typeof TopicMutationSchema>) {
    // Repository.mutate is the shared mutex and durable transaction for every topic writer.
    await this.repository.mutate((workspace) => applyTopicMutation(workspace, this.threadId, mutation))
  }

  async activatePart(topicId: string, topicPartId: string) {
    await this.write({ type: "activatePart", topicId, topicPartId })
  }

  async complete(topicId: string, topicPartId: string, masteryVerified = true) {
    await this.write({ type: "complete", topicId, topicPartId, masteryVerified })
  }

  async documentMistake(topicId: string, topicPartId: string, context: string, issue: string) {
    await this.write({ type: "documentMistake", topicId, topicPartId, context, issue })
  }

  async recordQuestion(topicId: string, topicPartId: string, question: string) {
    await this.write({ type: "recordQuestion", topicId, topicPartId, question })
  }

  async recordAnswer(topicId: string, topicPartId: string, answerFromUser: string, stepIndex?: number) {
    const { state } = this.topic(topicId)
    const steps = state.threadTutors.find((thread) => thread.id === this.threadId)?.progress[topicPartId]?.steps ?? []
    await this.write({ type: "recordAnswer", topicId, topicPartId, answerFromUser, stepIndex: stepIndex ?? steps.length - 1 })
  }

  async updateTopic(topicId: string, update: Omit<Extract<z.infer<typeof TopicMutationSchema>, { type: "updateTopic" }>, "type" | "topicId">) {
    await this.write({ type: "updateTopic", topicId, ...update })
  }

  async createTopic(topic: Extract<z.infer<typeof TopicMutationSchema>, { type: "createTopic" }>["topic"]) {
    const topicId = randomUUID()
    await this.write({ type: "createTopic", topicId, topic })
    return topicId
  }
}
