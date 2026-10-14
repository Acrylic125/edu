import { z } from "zod"
import { LearningStateSchema, TopicSchema, type Topic } from "../shared/contracts"

const handoffHeading = "## Handoff\n"
const keyHeading = "\n\n## Active check key\n"
const notesHeading = "\n\n## Working notes\n"

const HandoffSchema = z.object({
  Created: TopicSchema.shape.createdAt,
  Plan: z.enum(["confirmed", "awaiting confirmation"]),
  Phase: LearningStateSchema.shape.phase,
  "Current section": LearningStateSchema.shape.currentSection,
  "Active check": LearningStateSchema.shape.pendingQuestion,
  "Resume action": LearningStateSchema.shape.nextAction,
})

export function topicWorkpad(topic: Topic) {
  let plan = "awaiting confirmation"
  if (topic.planConfirmed) plan = "confirmed"
  const handoff = {
    Created: topic.createdAt,
    Plan: plan,
    Phase: topic.learning.phase,
    "Current section": topic.learning.currentSection,
    "Active check": topic.learning.pendingQuestion,
    "Resume action": topic.learning.nextAction,
  }
  // Indented continuation lines keep multi-line values from being read as another field or section.
  const fields = Object.entries(handoff).map(([label, value]) => `${label}: ${value.split("\n").join("\n  ")}`)
  return `${handoffHeading}${fields.join("\n")}${keyHeading}${topic.learning.privateAnswerKey}${notesHeading}${topic.learning.workpad}`
}

export function parseTopicWorkpad(text: string) {
  const keyStart = text.indexOf(keyHeading)
  const notesStart = text.indexOf(notesHeading, keyStart)
  if (!text.startsWith(handoffHeading) || keyStart < 0 || notesStart < 0) return
  const fields = new Map<string, string>()
  let label = ""
  for (const line of text.slice(handoffHeading.length, keyStart).split("\n")) {
    const field = /^([^\s:][^:]*): ?(.*)$/.exec(line)
    if (line.startsWith("  ") && label) {
      fields.set(label, `${fields.get(label)}\n${line.slice(2)}`)
    } else if (field) {
      label = field[1]
      fields.set(label, field[2])
    }
  }
  const handoff = HandoffSchema.parse(Object.fromEntries(fields))
  return {
    createdAt: handoff.Created,
    planConfirmed: handoff.Plan === "confirmed",
    phase: handoff.Phase,
    currentSection: handoff["Current section"],
    pendingQuestion: handoff["Active check"],
    nextAction: handoff["Resume action"],
    privateAnswerKey: text.slice(keyStart + keyHeading.length, notesStart),
    workpad: text.slice(notesStart + notesHeading.length),
  }
}
