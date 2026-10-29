import type { z } from "zod"
import type { PartProgressSchema, TopicPartSchema, TopicCheckSchema } from "./topic-state"

export class TopicCheckBlockedError extends Error {}

function reasoningText(text: string) {
  return text.toLowerCase().replace(/\d+(?:[.,]\d+)*/g, "#").replace(/[^\p{L}\p{N}#]+/gu, " ").trim()
}

export function validateCriterion(part: z.infer<typeof TopicPartSchema>, reference: Pick<z.infer<typeof TopicCheckSchema>, "goalIndex" | "criterionIndex">) {
  if (!part.goals[reference.goalIndex]?.understoodWhen[reference.criterionIndex])
    throw new Error("Select an existing goalIndex and criterionIndex from this part. An example does not create a new learning criterion.")
}

export function validateTopicCheck(part: z.infer<typeof TopicPartSchema>, progress: z.infer<typeof PartProgressSchema> | undefined, question: string, check?: z.infer<typeof TopicCheckSchema>) {
  const steps = progress?.steps ?? []
  // Legacy workflow operations must still replay; new model calls require check in the runner.
  if (!check) return
  validateCriterion(part, check)
  for (const step of steps) {
    if (reasoningText(step.question) === reasoningText(question))
      throw new TopicCheckBlockedError("This repeats an earlier check with changed wording or numbers. Reuse its evidence, explain any remaining gap, and continue without this check.")
  }
  const sameCriterion = (reference: Pick<z.infer<typeof TopicCheckSchema>, "goalIndex" | "criterionIndex">) => reference.goalIndex === check.goalIndex && reference.criterionIndex === check.criterionIndex
  const reviewSteps = steps.slice(steps.at(-1)?.reviewStartIndex ?? 0)
  const latestAssessment = reviewSteps.map((step, index) => ({ step, order: step.assessmentOrder ?? index }))
    .filter(({ step }) => step.assessment && sameCriterion(step.assessment))
    .sort((left, right) => left.order - right.order).at(-1)?.step.assessment
  // A completed part can be revisited for learner-selected practice without discarding its earlier evidence.
  if (progress?.status !== "completed" && latestAssessment?.status === "demonstrated")
    throw new TopicCheckBlockedError("This criterion is already demonstrated. Credit the recorded evidence and continue to a remaining criterion.")
  for (const step of steps) {
    if (step.check && sameCriterion(step.check) && reasoningText(step.check.reasoningTask) === reasoningText(check.reasoningTask))
      throw new TopicCheckBlockedError("This repeats the same reasoning task. Explain the remaining gap and continue, or choose a meaningfully different application of the original criterion.")
  }
  let consecutive = 0
  for (const step of reviewSteps.toReversed()) {
    if (!step.check || !sameCriterion(step.check)) break
    consecutive++
  }
  if (progress?.status !== "completed" && consecutive >= 2)
    throw new TopicCheckBlockedError("This criterion has already had a check and a follow-up. Explain the concept directly, preserve the uncertainty in the recorded assessment, and continue without another check on this criterion.")
}

export function rejectsRepeatedChecks(message: string) {
  return /\b(?:stop|quit)\b[^.!?\n]{0,100}\b(?:asking|repeating|quizzing)\b/i.test(message)
    || /\bwhy\b[^.!?\n]{0,150}\b(?:same\s+(?:questions?|qns?|checks?)|over\s+and\s+over)\b/i.test(message)
    || /\b(?:already\s+(?:answered|said|told)|keep\s+(?:asking|repeating))\b[^.!?\n]{0,100}\b(?:same|again|over\s+and\s+over)\b/i.test(message)
}
