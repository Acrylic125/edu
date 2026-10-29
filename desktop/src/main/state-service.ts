import { topicCompletionEvidence } from "../shared/topic-completion"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { type Topic, type Workspace } from "../shared/contracts"
import { applyTopicChanges, TopicMutationSchema, TopicStateSchema, TopicReferenceSchema, freshTopicState } from "../shared/topic-state"
import { newScratchpad, type WorkspaceRepository } from "./workspace"
import { applyContentChanges } from "../shared/content-document"
import { TopicCheckBlockedError, validateCriterion, validateTopicCheck } from "../shared/topic-feedback"
import { scratchpadMarkdown } from "../shared/scratchpad-markdown"
import { importStructuredContent } from "./structured-content-migration"
import { CreateGenericInputSchema, CreateTestInputSchema, GenericStateSchema, ScratchpadMutationSchema, ScratchpadStateSchema, ScratchpadTypeSchema, CreateTestQuestionInputSchema, TestStateSchema, scratchpadReferences, testScratchpadMarkdown } from "../shared/scratchpad-state"

export function applyTopicMutation(workspace: Pick<Workspace, "scratchpads" | "chats">, threadId: string, input: z.infer<typeof TopicMutationSchema>) {
  if (workspace.scratchpads.some((scratchpad) => scratchpad.id === input.scratchpadId && scratchpad.fileError))
    throw new Error("Reconcile the scratchpad's missing files before updating it.")
  const { scratchpads } = workspace
  const mutation = TopicMutationSchema.parse(input)
  if (mutation.type === "createTopic") {
    if (scratchpads.some((scratchpad) => scratchpad.id === mutation.scratchpadId)) throw new Error("Topic already exists.")
    const scratchpad = newScratchpad(mutation.scratchpad.name)
    scratchpad.id = mutation.scratchpadId
    scratchpad.createdAt = mutation.createdAt ?? workspace.chats.find((chat) => chat.id === threadId)?.messages.findLast((message) => message.role === "user")?.createdAt ?? scratchpad.createdAt
    scratchpad.state = TopicStateSchema.parse({ ...mutation.scratchpad, createdAt: scratchpad.createdAt, threadTutors: [{ id: threadId, progress: {} }] })
    attachReferencedMaterials(scratchpad, scratchpad.state, workspace, mutation.materialIds)
    scratchpad.state.document ??= { version: 1, blocks: [] }
    scratchpad.learning.notes = scratchpadMarkdown(scratchpad.state, scratchpad.materials)
    scratchpads.push(scratchpad)
    const chat = workspace.chats.find((chat) => chat.id === threadId)
    if (chat && !chat.ownerScratchpadId) {
      chat.ownerScratchpadId = scratchpad.id
    }
    return
  }
  const scratchpad = scratchpads.find((scratchpad) => scratchpad.id === mutation.scratchpadId)
  if (!scratchpad) throw new Error("Topic not found.")
  let state = TopicStateSchema.parse(importStructuredContent(scratchpad.state ?? { ...freshTopicState(scratchpad.title, scratchpad.createdAt), document: undefined }, scratchpad.learning.notes))
  let thread = state.threadTutors.find((thread) => thread.id === threadId)
  if (!thread) {
    thread = { id: threadId, progress: {} }
    state.threadTutors.push(thread)
  }
  if (mutation.type === "updateTopic") {
    if (mutation.expectedRevision !== undefined && mutation.expectedRevision !== state.revision)
      throw new Error("Topic changed during this turn. Read the latest state before editing.")
    if (mutation.changes && mutation.content) throw new Error("Supply changes, not a curriculum replacement.")
    if (mutation.changes) state = applyTopicChanges(state, mutation.changes)
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
    attachReferencedMaterials(scratchpad, state, workspace, mutation.materialIds)
    scratchpad.title = state.name
    state.revision++
    scratchpad.learning.outline = state.content.slice(0, 100).map((part) => part.name)
  } else if (mutation.type === "editTopicContent") {
    if (mutation.expectedRevision !== undefined && state.revision !== mutation.expectedRevision)
      throw new Error("Topic content changed during this turn. Read the latest state before editing.")
    state.document = applyContentChanges(state.document ?? { version: 1, blocks: [] }, mutation.changes)
    for (const id of mutation.present ?? []) {
      if (!state.document.blocks.some((block) => block.id === id)) throw new Error(`Presented content block not found: ${id}`)
    }
    state.revision++
  } else {
    const part = state.content.find((part) => part.id === mutation.scratchpadPartId)
    if (!part) throw new Error("Topic part not found.")
    const progress = thread.progress[part.id]
    if (mutation.type === "activatePart") {
      thread.currentPartId = part.id
      thread.progress[part.id] = { status: "active", steps: progress?.steps ?? [] }
    } else if (mutation.type === "complete") {
      if (!progress) throw new Error("Visit and activate the part before completing it.")
      if (mutation.evidenceKey) {
        const evidence = topicCompletionEvidence(part, progress)
        if (!evidence.complete || evidence.key !== mutation.evidenceKey)
          throw new Error("All required criteria must have current valid demonstrated evidence before completing this part.")
      }
      progress.status = "completed"
    } else if (mutation.type === "documentMistake") {
      part.mistakes.push({ context: mutation.context, issue: mutation.issue })
    } else if (mutation.type === "recordQuestion") {
      thread.currentPartId = part.id
      let check = mutation.check
      const resumeFrom = mutation.resumeFrom
      if (resumeFrom) {
        if (resumeFrom.threadId === threadId) throw new Error("This check is already in the current thread. Use its pendingCheck directly.")
        const source = state.threadTutors.find((thread) => thread.id === resumeFrom.threadId)?.progress[part.id]
        const sourceStep = source?.steps[resumeFrom.stepIndex]
        if (!sourceStep || resumeFrom.stepIndex !== source.steps.length - 1 || sourceStep.question !== mutation.question)
          throw new Error("resumeFrom must identify the exact latest question in its source thread and part. Read the recorded questions before resuming.")
        if (progress?.steps.some((step) => step.resumeFrom?.threadId === resumeFrom.threadId && step.resumeFrom.stepIndex === resumeFrom.stepIndex)) return
        if (sourceStep.assessment?.status === "demonstrated" || state.threadTutors.some((thread) => thread.progress[part.id]?.steps.some((step) => {
          if (step.assessment?.status !== "demonstrated") return false
          if (step.resumeFrom?.threadId === resumeFrom.threadId && step.resumeFrom.stepIndex === resumeFrom.stepIndex) return true
          return sourceStep.check !== undefined && step.assessment.goalIndex === sourceStep.check.goalIndex && step.assessment.criterionIndex === sourceStep.check.criterionIndex
        })))
          throw new TopicCheckBlockedError("This check has already been demonstrated in another thread. Use its recorded evidence and continue instead of asking it again.")
        check = sourceStep.check
      }
      validateTopicCheck(part, progress, mutation.question, check)
      let reviewStartIndex = progress?.steps.at(-1)?.reviewStartIndex ?? 0
      if (progress?.status === "completed") reviewStartIndex = progress.steps.length
      // Asking visits the part; keeping both changes atomic avoids an ordering dependency on the model.
      thread.progress[part.id] = { status: "active", steps: [...(progress?.steps ?? []), { question: mutation.question, check, reviewStartIndex, resumeFrom }] }
    } else if (mutation.type === "recordAnswer") {
      const step = progress?.steps[mutation.stepIndex]
      if (!step) throw new Error(`Question not found in this thread. This thread owns ${progress?.steps.length ?? 0} questions. Use the current thread's pendingCheck returned by topic_recordQuestion; resume another thread's check with resumeFrom before answering it.`)
      let additionalAnswer = step.additionalAnswers?.find((answer) => answer.answerFromUser === mutation.answerFromUser)
      if (step.answerFromUser !== undefined && step.answerFromUser !== mutation.answerFromUser && !additionalAnswer) {
        const messages = workspace.chats.find((chat) => chat.id === threadId)?.messages ?? []
        // Pin the source so committing a staged answer still works after another learner message arrives.
        const learner = messages.findLast((message) => message.role === "user" && message.content === mutation.answerFromUser && (!mutation.answerMessageId || message.id === mutation.answerMessageId))
        if (!learner || learner.content !== mutation.answerFromUser)
          throw new Error("Preserve the recorded answer unchanged. A further answer must match a genuine learner message verbatim. To reassess existing evidence, submit one of its recorded answers unchanged.")
        additionalAnswer = { messageId: learner.id, answerFromUser: learner.content }
      }
      const assessment = mutation.assessment
      if (step.check && !assessment && !step.assessment) throw new Error("Assess this answer against its recorded criterion with verbatim evidence before continuing.")
      if (assessment) {
        validateCriterion(part, assessment)
        const criterion = step.check ?? step.assessment
        if (criterion && (assessment.goalIndex !== criterion.goalIndex || assessment.criterionIndex !== criterion.criterionIndex))
          throw new Error("Assess the criterion selected by the recorded check. An incidental example cannot introduce a new requirement.")
        if (!assessment.evidence.some((evidence) => evidence.stepIndex === mutation.stepIndex && evidence.quote === mutation.answerFromUser))
          throw new Error("Assessment evidence must include the current actual answer verbatim.")
        for (const evidence of assessment.evidence) {
          const source = progress?.steps[evidence.stepIndex]
          const currentAnswer = evidence.stepIndex === mutation.stepIndex && evidence.quote === mutation.answerFromUser
          if (!currentAnswer && source?.answerFromUser !== evidence.quote && !source?.additionalAnswers?.some((answer) => answer.answerFromUser === evidence.quote))
            throw new Error("Cite the verbatim complete actual answer from an answered step in this part and thread. Keep inferred reasoning in interpretation.")
        }
        if (step.assessment && JSON.stringify(step.assessment) !== JSON.stringify(assessment))
          step.assessmentHistory = [...(step.assessmentHistory ?? []), step.assessment]
        if (JSON.stringify(step.assessment) !== JSON.stringify(assessment)) {
          const order = Math.max(progress.steps.length, ...progress.steps.map((entry) => entry.assessmentOrder ?? 0)) + 1
          if (mutation.assessmentOrder !== undefined && mutation.assessmentOrder !== order)
            throw new Error("Criterion evidence changed during this turn. Retry from the current assessments.")
          step.assessmentOrder = order
        }
        step.assessment = assessment
        if (assessment.status !== "demonstrated") progress.status = "active"
      }
      if (step.answerFromUser === undefined) step.answerFromUser = mutation.answerFromUser
      else if (additionalAnswer && !step.additionalAnswers?.some((answer) => answer.messageId === additionalAnswer.messageId))
        step.additionalAnswers = [...(step.additionalAnswers ?? []), additionalAnswer]
    }
  }
  validateDocumentSources(scratchpad, state, workspace)
  scratchpad.state = TopicStateSchema.parse(state)
  scratchpad.learning.notes = scratchpadMarkdown(scratchpad.state, scratchpad.materials)
}

function attachReferencedMaterials(scratchpad: Topic, state: z.infer<typeof ScratchpadStateSchema>, workspace: Pick<Workspace, "scratchpads" | "chats">, materialIds?: string[]) {
  const available = [...workspace.scratchpads, ...workspace.chats].flatMap((owner) => owner.materials)
  for (const reference of scratchpadReferences(state)) {
    if (reference.type === "website" || reference.type === "topic") continue
    const attached = scratchpad.materials.find((material) => reference.path === `assets/${material.name}`)
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
    scratchpad.materials.push(material)
  }
  for (const id of materialIds ?? []) {
    if (scratchpad.materials.some((material) => material.id === id)) continue
    const material = available.find((material) => material.id === id)
    if (!material) throw new Error("An attached source is unavailable. Attach it again before creating the scratchpad.")
    if (scratchpad.materials.some((attached) => attached.name === material.name))
      throw new Error(`Two attached sources use the filename ${material.name}. Rename one before attaching both.`)
    scratchpad.materials.push(material)
  }
}

function validateDocumentSources(scratchpad: Topic, state: z.infer<typeof TopicStateSchema> | z.infer<typeof TestStateSchema>, workspace: Pick<Workspace, "scratchpads" | "chats">) {
  for (const block of state.document?.blocks ?? []) {
    if (block.type !== "source") continue
    let material = scratchpad.materials.find((material) => material.id === block.materialId)
    if (!material) {
      material = [...workspace.scratchpads, ...workspace.chats].flatMap((owner) => owner.materials).find((material) => material.id === block.materialId)
      if (!material) throw new Error(`Content source not found: ${block.materialId}`)
      const name = material.name
      if (scratchpad.materials.some((attached) => attached.name === name)) throw new Error("Content source filename conflicts with an existing attachment.")
      scratchpad.materials.push(material)
    }
    if (block.page > (material.pages.length || 1)) throw new Error(`Content source page is outside ${material.name}.`)
    if (block.presentation === "image" && material.kind === "text") throw new Error("Text sources cannot be rendered as slide images.")
  }
}

export class StateService {
  constructor(private repository: Pick<WorkspaceRepository, "stateSnapshot" | "mutate">, readonly threadId: string) {}

  private scratchpad(id: string) {
    const scratchpad = this.repository.stateSnapshot.scratchpads.find((scratchpad) => scratchpad.id === id)
    if (!scratchpad) throw new Error("Topic not found.")
    return { scratchpad, state: TopicStateSchema.parse(scratchpad.state ?? freshTopicState(scratchpad.title, scratchpad.createdAt)) }
  }

  async getMistakesForTopic(scratchpads: string[] | null) {
    const selected = this.repository.stateSnapshot.scratchpads.filter((scratchpad) => (scratchpad.state?.type === "topic" || !scratchpad.state) && (scratchpads === null || scratchpads.includes(scratchpad.id)))
    if (scratchpads?.some((id) => !selected.some((scratchpad) => scratchpad.id === id))) throw new Error("Topic not found.")
    return selected.flatMap((scratchpad) => this.scratchpad(scratchpad.id).state.content.flatMap((part) => part.mistakes.map((mistake) => ({ scratchpadId: scratchpad.id, scratchpadName: scratchpad.title, scratchpadPartId: part.id, partName: part.name, ...mistake }))))
  }

  async whereAmI(scratchpadId: string) {
    const { state } = this.scratchpad(scratchpadId)
    const thread = state.threadTutors.find((thread) => thread.id === this.threadId)
    return state.content.flatMap((part) => {
      const progress = thread?.progress[part.id]
      if (!progress || progress.status !== "active") return []
      return [{ part, progress }]
    })
  }

  async whatIsNext(scratchpadId: string) {
    const { state } = this.scratchpad(scratchpadId)
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

  async getTopicProgress(scratchpadId: string) {
    const { state } = this.scratchpad(scratchpadId)
    return state.content.map((part) => ({
      part,
      threads: state.threadTutors.flatMap((thread) => {
        const progress = thread.progress[part.id]
        if (!progress) return []
        return [{ threadId: thread.id, progress }]
      }),
    }))
  }

  async getQuestions(scratchpadId: string, scratchpadPartId: string) {
    const { state } = this.scratchpad(scratchpadId)
    if (![...state.content, ...(state.removedParts ?? [])].some((part) => part.id === scratchpadPartId)) throw new Error("Topic part not found.")
    return state.threadTutors.flatMap((thread) => (thread.progress[scratchpadPartId]?.steps ?? []).map((step, stepIndex) => ({ threadId: thread.id, stepIndex, ...step })))
  }

  async write(mutation: z.infer<typeof ScratchpadMutationSchema>) {
    // Repository.mutate is the shared mutex and durable transaction for every topic writer.
    await this.repository.mutate((workspace) => applyScratchpadMutation(workspace, this.threadId, mutation))
  }

  async activatePart(scratchpadId: string, scratchpadPartId: string) {
    await this.write({ type: "activatePart", scratchpadId, scratchpadPartId })
  }

  async complete(scratchpadId: string, scratchpadPartId: string) {
    await this.write({ type: "complete", scratchpadId, scratchpadPartId })
  }

  async documentMistake(scratchpadId: string, scratchpadPartId: string, context: string, issue: string) {
    await this.write({ type: "documentMistake", scratchpadId, scratchpadPartId, context, issue })
  }

  async recordQuestion(scratchpadId: string, scratchpadPartId: string, question: string) {
    await this.write({ type: "recordQuestion", scratchpadId, scratchpadPartId, question })
  }

  async recordAnswer(scratchpadId: string, scratchpadPartId: string, answerFromUser: string, stepIndex?: number) {
    const { state } = this.scratchpad(scratchpadId)
    const steps = state.threadTutors.find((thread) => thread.id === this.threadId)?.progress[scratchpadPartId]?.steps ?? []
    await this.write({ type: "recordAnswer", scratchpadId, scratchpadPartId, answerFromUser, stepIndex: stepIndex ?? steps.length - 1 })
  }

  async updateTopic(scratchpadId: string, update: Omit<Extract<z.infer<typeof TopicMutationSchema>, { type: "updateTopic" }>, "type" | "scratchpadId">) {
    await this.write({ type: "updateTopic", scratchpadId, ...update })
  }

  async createScratchpad(scratchpad: Extract<z.input<typeof TopicMutationSchema>, { type: "createTopic" }>["scratchpad"]) {
    const scratchpadId = randomUUID()
    await this.write(TopicMutationSchema.parse({ type: "createTopic", scratchpadId, scratchpad }))
    return scratchpadId
  }

  private test(id: string) {
    const scratchpad = this.repository.stateSnapshot.scratchpads.find((item) => item.id === id)
    if (!scratchpad) throw new Error("Test scratchpad not found.")
    return TestStateSchema.parse(scratchpad.state)
  }

  async getTestMistakes(id: string) {
    return this.test(id).content.flatMap((part) => part.mistakes.map((mistake) => ({ scratchpadPartId: part.id, ...mistake })))
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
    const scratchpad = this.repository.stateSnapshot.scratchpads.find((item) => item.id === id)
    if (!scratchpad) throw new Error("Generic scratchpad not found.")
    return GenericStateSchema.parse(scratchpad.state).references
  }

  async createTest(test: z.input<typeof CreateTestInputSchema>) {
    const scratchpadId = randomUUID()
    await this.write(ScratchpadMutationSchema.parse({ type: "createTest", scratchpadId, test }))
    return scratchpadId
  }

  async createGeneric(generic: z.infer<typeof CreateGenericInputSchema>) {
    const scratchpadId = randomUUID()
    await this.write({ type: "createGeneric", scratchpadId, generic })
    return scratchpadId
  }

  async addTestQuestion(scratchpadId: string, question: z.input<typeof CreateTestQuestionInputSchema>) {
    await this.write({ type: "addTestQuestion", scratchpadId, question })
  }

  async recordTestAnswer(scratchpadId: string, title: string, answer: string) {
    await this.write({ type: "recordTestAnswer", scratchpadId, title, answer })
  }

  async documentTestMistake(scratchpadId: string, scratchpadPartId: string, context: string, issue: string) {
    await this.write({ type: "documentTestMistake", scratchpadId, scratchpadPartId, context, issue })
  }

  async addGenericReference(scratchpadId: string, reference: z.infer<typeof TopicReferenceSchema>) {
    await this.write({ type: "addGenericReference", scratchpadId, reference })
  }

}

export function existingScratchpadForCreation(workspace: Pick<Workspace, "scratchpads" | "chats">, threadId: string, mutation: z.infer<typeof ScratchpadMutationSchema>) {
  let type: z.infer<typeof ScratchpadTypeSchema> | undefined
  let name = ""
  if (mutation.type === "createTopic") {
    type = "topic"
    name = mutation.scratchpad.name
  } else if (mutation.type === "createTest") {
    type = "test"
    name = mutation.test.name
  } else if (mutation.type === "createGeneric") {
    type = "generic"
    name = mutation.generic.name
  } else return
  const request = workspace.chats.find((chat) => chat.id === threadId)?.messages.findLast((message) => message.role === "user")
  const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
  return workspace.scratchpads.find((scratchpad) => !scratchpad.archived && request?.scratchpadIds.includes(scratchpad.id) &&
    scratchpad.state?.type === type && normalize(scratchpad.title) === normalize(name))
}

export function applyScratchpadMutation(workspace: Pick<Workspace, "scratchpads" | "chats">, threadId: string, input: z.infer<typeof ScratchpadMutationSchema>) {
  if (workspace.scratchpads.some((scratchpad) => scratchpad.id === input.scratchpadId && scratchpad.fileError))
    throw new Error("Reconcile the scratchpad's missing files before updating it.")
  const mutation = ScratchpadMutationSchema.parse(input)
  if (workspace.scratchpads.some((item) => item.id === mutation.scratchpadId && item.archived))
    throw new Error("Archived scratchpads are read-only.")
  const existing = existingScratchpadForCreation(workspace, threadId, mutation)
  if (existing) {
    if (existing.id === mutation.scratchpadId) return
    throw new Error("This request already has a scratchpad with this name and type. Update the existing scratchpad instead of creating another copy.")
  }
  const request = workspace.chats.find((chat) => chat.id === threadId)?.messages.findLast((message) => message.role === "user")
  const topicMutation = TopicMutationSchema.safeParse(mutation)
  if (topicMutation.success) {
    applyTopicMutation(workspace, threadId, topicMutation.data)
    if (topicMutation.data.type === "createTopic" && request && !request.scratchpadIds.includes(mutation.scratchpadId))
      request.scratchpadIds.push(mutation.scratchpadId)
    return
  }
  if (mutation.type === "createTest" || mutation.type === "createGeneric") {
    if (workspace.scratchpads.some((item) => item.id === mutation.scratchpadId)) throw new Error("Scratchpad already exists.")
    let state: z.infer<typeof ScratchpadStateSchema>
    // Legacy staged creations have no timestamp; their initiating message is stable across replays.
    const createdAt = mutation.createdAt ?? request?.createdAt ?? new Date().toISOString()
    if (mutation.type === "createTest") {
      state = TestStateSchema.parse({ ...mutation.test, createdAt, questions: mutation.test.questions.map((question) => ({ ...question, threadWriters: [threadId] })) })
    } else state = GenericStateSchema.parse({ ...mutation.generic, createdAt })
    const scratchpad = newScratchpad(state.name)
    scratchpad.id = mutation.scratchpadId
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
    workspace.scratchpads.push(scratchpad)
    const chat = workspace.chats.find((chat) => chat.id === threadId)
    if (chat && !chat.ownerScratchpadId) {
      chat.ownerScratchpadId = scratchpad.id
    }
    if (request && !request.scratchpadIds.includes(mutation.scratchpadId)) request.scratchpadIds.push(mutation.scratchpadId)
    return
  }
  const scratchpad = workspace.scratchpads.find((item) => item.id === mutation.scratchpadId)
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
    const part = state.content.find((part) => part.id === mutation.scratchpadPartId)
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
