import { randomUUID } from "node:crypto"
import { z } from "zod"
import { type Topic, type Workspace } from "../shared/contracts"
import { TopicMutationSchema, TopicStateSchema, freshTopicState } from "../shared/topic-state"
import { newTopic, type WorkspaceRepository } from "./workspace"

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
    if (mutation.summary !== undefined) {
      const body = mutation.summary.replace(/^\s*# [^\r\n]*(?:\r?\n|$)/, "").trimStart()
      topic.learning.notes = `# ${state.name}\n\n${body}`
    } else {
      const body = topic.learning.notes.replace(/^\s*# [^\r\n]*(?:\r?\n|$)/, "").trimStart()
      if (!body.trim()) topic.learning.notes = summaryFor(state)
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
      progress.status = "completed"
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
    if (reference.type !== "image" && reference.pages.some((range) => range.to > material.pages.length))
      throw new Error(`Reference pages are outside ${material.name}.`)
    topic.materials.push(material)
  }
}

function summaryFor(state: z.infer<typeof TopicStateSchema>) {
  return `# ${state.name}\n\n${state.content.map((part) => `## ${part.name}\n\n${part.goals.objective}`).join("\n\n")}`
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

  async complete(topicId: string, topicPartId: string) {
    await this.write({ type: "complete", topicId, topicPartId })
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
