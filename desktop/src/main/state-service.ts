import { randomUUID } from "node:crypto"
import { z } from "zod"
import { type Topic, type Workspace } from "../shared/contracts"
import { TopicMutationSchema, TopicStateSchema, TopicReferenceSchema, freshTopicState } from "../shared/topic-state"
import { newTopic, type WorkspaceRepository } from "./workspace"
import { applyContentChanges } from "../shared/content-document"
import { scratchpadMarkdown } from "../shared/scratchpad-markdown"
import { importStructuredContent } from "./structured-content-migration"
import { CreateGenericInputSchema, CreateTestInputSchema, GenericStateSchema, ScratchpadMutationSchema, ScratchpadStateSchema, ScratchpadTypeSchema, CreateTestQuestionInputSchema, TestStateSchema, scratchpadReferences, testScratchpadMarkdown } from "../shared/scratchpad-state"

export function applyTopicMutation(workspace: Pick<Workspace, "topics" | "chats">, threadId: string, input: z.infer<typeof TopicMutationSchema>) {
  const { topics } = workspace
  const mutation = TopicMutationSchema.parse(input)
  if (mutation.type === "createTopic") {
    if (topics.some((topic) => topic.id === mutation.topicId)) throw new Error("Topic already exists.")
    const topic = newTopic(mutation.topic.name)
    topic.id = mutation.topicId
    topic.state = TopicStateSchema.parse({ ...mutation.topic, createdAt: topic.createdAt, threadTutors: [{ id: threadId, progress: {} }] })
    attachReferencedMaterials(topic, topic.state, workspace, mutation.materialIds)
    topic.state.document ??= { version: 1, blocks: [] }
    topic.learning.notes = scratchpadMarkdown(topic.state, topic.materials)
    topics.push(topic)
    return
  }
  const topic = topics.find((topic) => topic.id === mutation.topicId)
  if (!topic) throw new Error("Topic not found.")
  const state = TopicStateSchema.parse(importStructuredContent(topic.state ?? { ...freshTopicState(topic.title, topic.createdAt), document: undefined }, topic.learning.notes))
  let thread = state.threadTutors.find((thread) => thread.id === threadId)
  if (!thread) {
    thread = { id: threadId, progress: {} }
    state.threadTutors.push(thread)
  }
  if (mutation.type === "updateTopic") {
    if (mutation.expectedContent !== undefined && JSON.stringify(mutation.expectedContent) !== JSON.stringify(state.content))
      throw new Error("Topic curriculum changed during this turn. Retry to preserve the latest goals and evidence.")
    if (mutation.name !== undefined) state.name = mutation.name
    const originalContent = state.content
    if (mutation.content !== undefined) {
      // Curriculum edits retain recorded mistakes; they cannot discard another thread's evidence.
      state.content = mutation.content.map((part) => ({
        ...part,
        mistakes: state.content.find((current) => current.id === part.id)?.mistakes ?? part.mistakes,
      }))
      for (const part of originalContent) {
        if (part.mistakes.length && !state.content.some((current) => current.id === part.id))
          throw new Error("A part with recorded mistakes cannot be removed.")
      }
    }
    TopicStateSchema.parse(state)
    attachReferencedMaterials(topic, state, workspace, mutation.materialIds)
    topic.title = state.name
    state.revision++
    topic.learning.outline = state.content.slice(0, 100).map((part) => part.name)
  } else if (mutation.type === "editTopicContent") {
    if (mutation.expectedRevision !== undefined && state.revision !== mutation.expectedRevision)
      throw new Error("Topic content changed during this turn. Read the latest state before editing.")
    state.document = applyContentChanges(state.document ?? { version: 1, blocks: [] }, mutation.changes)
    for (const id of mutation.present ?? []) {
      if (!state.document.blocks.some((block) => block.id === id)) throw new Error(`Presented content block not found: ${id}`)
    }
    state.revision++
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
  validateDocumentSources(topic, state, workspace)
  topic.state = TopicStateSchema.parse(state)
  topic.learning.notes = scratchpadMarkdown(topic.state, topic.materials)
}

function attachReferencedMaterials(topic: Topic, state: z.infer<typeof ScratchpadStateSchema>, workspace: Pick<Workspace, "topics" | "chats">, materialIds?: string[]) {
  const available = [...workspace.topics, ...workspace.chats].flatMap((owner) => owner.materials)
  for (const reference of scratchpadReferences(state)) {
    if (reference.type === "website" || reference.type === "topic") continue
    const attached = topic.materials.find((material) => reference.path === `assets/${material.name}`)
    if (attached) {
      if ((reference.type === "pdf" || reference.type === "ppt") && reference.pages.some((range) => range.to > attached.pages.length))
        throw new Error(`Reference pages are outside ${attached.name}.`)
      continue
    }
    const matches = new Map(available
      .filter((material) => reference.path === `assets/${material.name}` && (!materialIds || materialIds.includes(material.id)))
      .map((material) => [material.id, material]))
    if (matches.size !== 1) throw new Error(`Reference ${reference.path} needs one supplied source. Use materialIds to select it when filenames are ambiguous.`)
    const material = [...matches.values()][0]
    if ((reference.type === "pdf" || reference.type === "ppt") && reference.pages.some((range) => range.to > material.pages.length))
      throw new Error(`Reference pages are outside ${material.name}.`)
    topic.materials.push(material)
  }
  for (const id of materialIds ?? []) {
    if (topic.materials.some((material) => material.id === id)) continue
    const material = available.find((material) => material.id === id)
    if (!material) throw new Error("An attached source is unavailable. Attach it again before creating the scratchpad.")
    if (topic.materials.some((attached) => attached.name === material.name))
      throw new Error(`Two attached sources use the filename ${material.name}. Rename one before attaching both.`)
    topic.materials.push(material)
  }
}

function validateDocumentSources(topic: Topic, state: z.infer<typeof TopicStateSchema> | z.infer<typeof TestStateSchema>, workspace: Pick<Workspace, "topics" | "chats">) {
  for (const block of state.document?.blocks ?? []) {
    if (block.type !== "source") continue
    let material = topic.materials.find((material) => material.id === block.materialId)
    if (!material) {
      material = [...workspace.topics, ...workspace.chats].flatMap((owner) => owner.materials).find((material) => material.id === block.materialId)
      if (!material) throw new Error(`Content source not found: ${block.materialId}`)
      const name = material.name
      if (topic.materials.some((attached) => attached.name === name)) throw new Error("Content source filename conflicts with an existing attachment.")
      topic.materials.push(material)
    }
    if (block.page > (material.pages.length || 1)) throw new Error(`Content source page is outside ${material.name}.`)
    if (block.presentation === "image" && material.kind === "text") throw new Error("Text sources cannot be rendered as slide images.")
  }
}

export class StateService {
  constructor(private repository: Pick<WorkspaceRepository, "stateSnapshot" | "mutate">, readonly threadId: string) {}

  private topic(id: string) {
    const topic = this.repository.stateSnapshot.topics.find((topic) => topic.id === id)
    if (!topic) throw new Error("Topic not found.")
    return { topic, state: TopicStateSchema.parse(topic.state ?? freshTopicState(topic.title, topic.createdAt)) }
  }

  async getMistakesForTopic(topics: string[] | null) {
    const selected = this.repository.stateSnapshot.topics.filter((topic) => (topic.state?.type === "topic" || !topic.state) && (topics === null || topics.includes(topic.id)))
    if (topics?.some((id) => !selected.some((topic) => topic.id === id))) throw new Error("Topic not found.")
    return selected.flatMap((topic) => this.topic(topic.id).state.content.flatMap((part) => part.mistakes.map((mistake) => ({ topicId: topic.id, topicName: topic.title, topicPartId: part.id, partName: part.name, ...mistake }))))
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

  async write(mutation: z.infer<typeof ScratchpadMutationSchema>) {
    // Repository.mutate is the shared mutex and durable transaction for every topic writer.
    await this.repository.mutate((workspace) => applyScratchpadMutation(workspace, this.threadId, mutation))
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

  async createTopic(topic: Extract<z.input<typeof TopicMutationSchema>, { type: "createTopic" }>["topic"]) {
    const topicId = randomUUID()
    await this.write(TopicMutationSchema.parse({ type: "createTopic", topicId, topic }))
    return topicId
  }

  private test(id: string) {
    const scratchpad = this.repository.stateSnapshot.topics.find((item) => item.id === id)
    if (!scratchpad) throw new Error("Test scratchpad not found.")
    return TestStateSchema.parse(scratchpad.state)
  }

  async getTestMistakes(id: string) {
    return this.test(id).content.flatMap((part) => part.mistakes.map((mistake) => ({ topicPartId: part.id, ...mistake })))
  }

  async whereAmIForTest(id: string) {
    const questions = this.test(id).questions
    return questions.find((question) => question.answer === undefined && question.threadWriters.includes(this.threadId)) ??
      questions.find((question) => question.answer === undefined) ?? null
  }

  async getTestQuestions(id: string) {
    return this.test(id).questions
  }

  async getGenericReferences(id: string) {
    const scratchpad = this.repository.stateSnapshot.topics.find((item) => item.id === id)
    if (!scratchpad) throw new Error("Generic scratchpad not found.")
    return GenericStateSchema.parse(scratchpad.state).references
  }

  async createTest(test: z.input<typeof CreateTestInputSchema>) {
    const topicId = randomUUID()
    await this.write(ScratchpadMutationSchema.parse({ type: "createTest", topicId, test }))
    return topicId
  }

  async createGeneric(generic: z.infer<typeof CreateGenericInputSchema>) {
    const topicId = randomUUID()
    await this.write({ type: "createGeneric", topicId, generic })
    return topicId
  }

  async addTestQuestion(topicId: string, question: z.input<typeof CreateTestQuestionInputSchema>) {
    await this.write({ type: "addTestQuestion", topicId, question })
  }

  async recordTestAnswer(topicId: string, title: string, answer: string) {
    await this.write({ type: "recordTestAnswer", topicId, title, answer })
  }

  async documentTestMistake(topicId: string, topicPartId: string, context: string, issue: string) {
    await this.write({ type: "documentTestMistake", topicId, topicPartId, context, issue })
  }

  async addGenericReference(topicId: string, reference: z.infer<typeof TopicReferenceSchema>) {
    await this.write({ type: "addGenericReference", topicId, reference })
  }

}

export function existingScratchpadForCreation(workspace: Pick<Workspace, "topics" | "chats">, threadId: string, mutation: z.infer<typeof ScratchpadMutationSchema>) {
  let type: z.infer<typeof ScratchpadTypeSchema> | undefined
  let name = ""
  if (mutation.type === "createTopic") {
    type = "topic"
    name = mutation.topic.name
  } else if (mutation.type === "createTest") {
    type = "test"
    name = mutation.test.name
  } else if (mutation.type === "createGeneric") {
    type = "generic"
    name = mutation.generic.name
  } else return
  const request = workspace.chats.find((chat) => chat.id === threadId)?.messages.findLast((message) => message.role === "user")
  const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
  return workspace.topics.find((scratchpad) => !scratchpad.archived && request?.topicIds.includes(scratchpad.id) &&
    scratchpad.state?.type === type && normalize(scratchpad.title) === normalize(name))
}

export function applyScratchpadMutation(workspace: Pick<Workspace, "topics" | "chats">, threadId: string, input: z.infer<typeof ScratchpadMutationSchema>) {
  const mutation = ScratchpadMutationSchema.parse(input)
  if (workspace.topics.some((item) => item.id === mutation.topicId && item.archived))
    throw new Error("Archived scratchpads are read-only.")
  const existing = existingScratchpadForCreation(workspace, threadId, mutation)
  if (existing) {
    if (existing.id === mutation.topicId) return
    throw new Error("This request already has a scratchpad with this name and type. Update the existing scratchpad instead of creating another copy.")
  }
  const request = workspace.chats.find((chat) => chat.id === threadId)?.messages.findLast((message) => message.role === "user")
  const topicMutation = TopicMutationSchema.safeParse(mutation)
  if (topicMutation.success) {
    applyTopicMutation(workspace, threadId, topicMutation.data)
    if (topicMutation.data.type === "createTopic" && request && !request.topicIds.includes(mutation.topicId))
      request.topicIds.push(mutation.topicId)
    return
  }
  if (mutation.type === "createTest" || mutation.type === "createGeneric") {
    if (workspace.topics.some((item) => item.id === mutation.topicId)) throw new Error("Scratchpad already exists.")
    let state: z.infer<typeof ScratchpadStateSchema>
    const createdAt = new Date().toISOString()
    if (mutation.type === "createTest") {
      state = TestStateSchema.parse({ ...mutation.test, createdAt, questions: mutation.test.questions.map((question) => ({ ...question, threadWriters: [threadId] })) })
    } else state = GenericStateSchema.parse({ ...mutation.generic, createdAt })
    const scratchpad = newTopic(state.name)
    scratchpad.id = mutation.topicId
    scratchpad.createdAt = createdAt
    scratchpad.state = state
    scratchpad.planConfirmed = true
    scratchpad.learning.phase = "ready_to_continue"
    scratchpad.learning.notes = `# ${state.name}\n\n`
    if (state.type === "test") {
      state.document ??= { version: 1, blocks: [] }
      scratchpad.learning.notes = scratchpadMarkdown(state, scratchpad.materials)
    }
    attachReferencedMaterials(scratchpad, state, workspace, mutation.materialIds)
    workspace.topics.push(scratchpad)
    if (request && !request.topicIds.includes(mutation.topicId)) request.topicIds.push(mutation.topicId)
    return
  }
  const scratchpad = workspace.topics.find((item) => item.id === mutation.topicId)
  if (!scratchpad) throw new Error("Scratchpad not found.")
  if (mutation.type === "addGenericReference" || mutation.type === "updateGeneric") {
    const state = GenericStateSchema.parse(scratchpad.state)
    if (mutation.type === "addGenericReference") {
      state.references.push(mutation.reference)
      attachReferencedMaterials(scratchpad, state, workspace, mutation.materialIds)
    } else {
      if (mutation.expectedSummary !== undefined && scratchpad.learning.notes !== mutation.expectedSummary)
        throw new Error("Scratchpad changed during this turn. Retry to preserve the latest edits.")
      if (mutation.name !== undefined) state.name = mutation.name
      if (mutation.summary !== undefined) scratchpad.learning.notes = mutation.summary
      const body = scratchpad.learning.notes.replace(/^\s*# [^\r\n]*(?:\r?\n|$)/, "").trimStart()
      scratchpad.learning.notes = `# ${state.name}\n\n${body}`
    }
    scratchpad.state = GenericStateSchema.parse(state)
    scratchpad.title = state.name
    return
  }
  const state = TestStateSchema.parse(importStructuredContent(TestStateSchema.parse(scratchpad.state), scratchpad.learning.notes))
  if (mutation.type === "addTestQuestion") {
    state.questions.push({ ...mutation.question, threadWriters: [threadId] })
    attachReferencedMaterials(scratchpad, state, workspace, mutation.materialIds)
  } else if (mutation.type === "recordTestAnswer") {
    const question = state.questions.find((question) => question.title === mutation.title)
    if (!question) throw new Error("Test question not found.")
    if (question.answer !== undefined) throw new Error("This answer is already recorded. A later attempt is a new question.")
    question.answer = mutation.answer
    if (!question.threadWriters.includes(threadId)) question.threadWriters.push(threadId)
  } else if (mutation.type === "documentTestMistake") {
    const part = state.content.find((part) => part.id === mutation.topicPartId)
    if (!part) throw new Error("Test content part not found.")
    part.mistakes.push({ context: mutation.context, issue: mutation.issue })
  } else if (mutation.type === "editTestContent") {
    if (mutation.expectedRevision !== undefined && state.revision !== mutation.expectedRevision)
      throw new Error("Test content changed during this turn. Read the latest state before editing.")
    state.document = applyContentChanges(state.document ?? { version: 1, blocks: [] }, mutation.changes)
    for (const id of mutation.present ?? []) {
      if (!state.document.blocks.some((block) => block.id === id)) throw new Error(`Presented content block not found: ${id}`)
    }
    state.revision++
  } else if (mutation.type === "updateTest") {
    if (mutation.expectedState !== undefined && JSON.stringify(state) !== JSON.stringify(mutation.expectedState))
      throw new Error("Test changed during this turn. Retry to preserve the latest edits.")
    if (mutation.name !== undefined) state.name = mutation.name
    if (mutation.goals !== undefined) state.goals = mutation.goals
    if (mutation.references !== undefined) state.references = mutation.references
    if (mutation.content !== undefined) {
      for (const part of state.content) {
        if (part.mistakes.length && !mutation.content.some((entry) => entry.id === part.id))
          throw new Error("A part with recorded mistakes cannot be removed.")
      }
      state.content = mutation.content.map((part) => ({ ...part, mistakes: state.content.find((entry) => entry.id === part.id)?.mistakes ?? part.mistakes }))
    }
    attachReferencedMaterials(scratchpad, state, workspace, mutation.materialIds)
    state.revision++
  } else throw new Error("Invalid scratchpad mutation.")
  validateDocumentSources(scratchpad, state, workspace)
  scratchpad.state = TestStateSchema.parse(state)
  scratchpad.title = state.name
  state.document ??= { version: 1, blocks: [] }
  scratchpad.learning.notes = scratchpadMarkdown(state, scratchpad.materials)
}
