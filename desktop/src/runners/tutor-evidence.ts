import type { z } from "zod"
import type { WorkerJob } from "../shared/contracts"
import type { TopicStateSchema } from "../shared/topic-state"
import { parseTopicMentions } from "../shared/topic-mentions"

export function selectTutorTopicIds(chat: WorkerJob["chat"], openedScratchpadId?: string, confirmScratchpadId?: string) {
  const request = chat.messages.findLast((message) => message.role === "user")
  const explicit = [...new Set(parseTopicMentions(request?.content ?? "").map((mention) => mention.id))]
  if (confirmScratchpadId) return [...new Set([...explicit, confirmScratchpadId])]
  if (explicit.length) return explicit
  if (chat.learning.pendingCheck) return [chat.learning.pendingCheck.scratchpadId]
  if (openedScratchpadId) return [openedScratchpadId]
  return chat.messages.findLast((message) => message.scratchpadIds.length)?.scratchpadIds ?? []
}

export function topicPartCoverage(state: z.infer<typeof TopicStateSchema>, part: z.infer<typeof TopicStateSchema>["content"][number]) {
  const progress = state.threadTutors.flatMap((thread) => {
    const entry = thread.progress[part.id]
    if (entry) return [entry]
    return []
  })
  const questionCount = progress.reduce((count, entry) => count + entry.steps.length, 0)
  const answeredCount = progress.reduce((count, entry) => count + entry.steps.filter((step) => step.answerFromUser !== undefined).length, 0)
  const taughtBlockCount = (state.document?.blocks ?? []).filter((block) => block.type === "markdown" && block.sectionId === part.id && block.content.some((line) => line.trim())).length
  let coverage = "untaught"
  if (progress.some((entry) => entry.status === "completed")) coverage = "completed"
  else if (questionCount || taughtBlockCount) coverage = "partial"
  return { coverage, questionCount, answeredCount, taughtBlockCount }
}

export function scratchpadContext(scratchpad: Pick<WorkerJob["scratchpads"][number], "id" | "state">, chat: WorkerJob["chat"]) {
  const state = scratchpad.state
  if (!state) return { type: "topic", revision: 0 }
  if (state.type === "generic") return { type: state.type, references: state.references }
  if (state.type === "test") {
    const pendingQuestion = state.questions.find((question) => question.answer === undefined && question.threadWriters.includes(chat.id)) ?? state.questions.find((question) => question.answer === undefined)
    return {
      type: state.type, revision: state.revision, goals: state.goals, references: state.references,
      content: state.content.map(({ id, parent, name }) => ({ id, parent, name })),
      questionCount: state.questions.length, answeredCount: state.questions.filter((question) => question.answer !== undefined).length,
      pendingQuestion,
    }
  }
  const thread = state.threadTutors.find((thread) => thread.id === chat.id)
  const progress = thread?.progress ?? {}
  const focused = new Set<string>()
  if (chat.learning.pendingCheck?.scratchpadId === scratchpad.id) focused.add(chat.learning.pendingCheck.scratchpadPartId)
  if (!focused.size && thread?.currentPartId) focused.add(thread.currentPartId)
  if (!focused.size) {
    const active = state.content.findLast((part) => progress[part.id]?.status === "active")
    if (active) focused.add(active.id)
  }
  if (!focused.size) {
    const next = state.content.find((part) => progress[part.id]?.status !== "completed")
    if (next) focused.add(next.id)
  }
  return {
    type: state.type, revision: state.revision,
    terminology: state.document?.blocks.filter((block) => block.type === "term").map(({ id, term }) => ({ id, term })) ?? [],
    content: state.content.map((part) => ({ id: part.id, parent: part.parent, name: part.name, status: progress[part.id]?.status, ...topicPartCoverage(state, part) })),
    focusedParts: state.content.filter((part) => focused.has(part.id)).map((part) => {
      const steps = progress[part.id]?.steps ?? []
      let stepIndex = steps.length - 1
      const pending = chat.learning.pendingCheck
      if (pending?.scratchpadId === scratchpad.id && pending.scratchpadPartId === part.id) stepIndex = pending.stepIndex
      const assessments = new Map<string, NonNullable<typeof steps[number]["assessment"]>>()
      for (const { step } of steps.map((step, index) => ({ step, order: step.assessmentOrder ?? index })).sort((left, right) => left.order - right.order)) {
        if (step.assessment) assessments.set(`${step.assessment.goalIndex}:${step.assessment.criterionIndex}`, step.assessment)
      }
      return {
        ...part, stepIndex, latestStep: steps[stepIndex],
        assessments: [...assessments.values()],
        blocks: state.document?.blocks.filter((block) => block.type !== "term" && block.sectionId === part.id).map(({ id, type }) => ({ id, type })) ?? [],
      }
    }),
  }
}
