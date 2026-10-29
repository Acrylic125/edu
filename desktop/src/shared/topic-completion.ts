import { createHash } from "node:crypto"
import type { z } from "zod"
import type { PartProgressSchema, TopicPartSchema } from "./topic-state"

export function topicCompletionEvidence(part: z.infer<typeof TopicPartSchema>, progress: z.infer<typeof PartProgressSchema>) {
  const reviewStart = progress.steps.at(-1)?.reviewStartIndex ?? 0
  const latest = new Map<string, { order: number; demonstrated: boolean }>()
  for (const [index, step] of progress.steps.entries()) {
    if (index < reviewStart) continue
    const assessment = step.assessment
    const reference = assessment ?? step.check
    if (!reference) continue
    const key = `${reference.goalIndex}:${reference.criterionIndex}`
    const order = step.assessmentOrder ?? index
    if ((latest.get(key)?.order ?? -1) > order) continue
    const valid = assessment !== undefined && assessment.status === "demonstrated" && !assessment.remainingGap.trim()
      && (!step.check || (step.check.goalIndex === assessment.goalIndex && step.check.criterionIndex === assessment.criterionIndex))
      && assessment.evidence.some((evidence) => evidence.stepIndex === index && (step.answerFromUser === evidence.quote || step.additionalAnswers?.some((answer) => answer.answerFromUser === evidence.quote)))
      && assessment.evidence.every((evidence) => {
        const source = progress.steps[evidence.stepIndex]
        return source !== undefined && (source.answerFromUser === evidence.quote || source.additionalAnswers?.some((answer) => answer.answerFromUser === evidence.quote))
      })
    latest.set(key, { order, demonstrated: valid })
  }
  const criteria = part.goals.flatMap((goal, goalIndex) => goal.understoodWhen.map((_, criterionIndex) => `${goalIndex}:${criterionIndex}`))
  return {
    complete: criteria.length > 0 && criteria.every((key) => latest.get(key)?.demonstrated),
    key: createHash("sha256").update(JSON.stringify({ goals: part.goals, steps: progress.steps })).digest("hex"),
  }
}
