import { z } from "zod"
import { TopicSchema, WorkspaceSchema } from "../shared/contracts"
import { ScratchpadStateSchema } from "../shared/scratchpad-state"
import { PartProgressSchema, TopicPartSchema, TopicReferenceSchema, TopicStateSchema } from "../shared/topic-state"

const LegacyPartSchema = TopicPartSchema.extend({
  get parent() { return LegacyPartSchema.optional() },
  goals: z.object({
    id: z.string().regex(/^tpg-[a-zA-Z0-9-]+$/),
    objective: TopicPartSchema.shape.goals.element.shape.objective,
    understoodWhen: TopicPartSchema.shape.goals.element.shape.understoodWhen,
  }).transform(({ objective, understoodWhen }) => [{ objective, understoodWhen }]),
  references: z.array(z.union([
    TopicReferenceSchema,
    z.object({ type: z.literal("text"), path: TopicReferenceSchema.options[0].shape.path }),
  ])).max(1000).transform((references) => references.map((reference) => {
    if (reference.type === "text") return { ...reference, type: "other-file" as const }
    return reference
  })),
})

const LegacyTopicStateSchema = z.object(TopicStateSchema.shape).extend({
  type: z.undefined().optional(),
  content: z.array(LegacyPartSchema).max(1000),
  threadTutors: z.array(z.object({
    id: TopicStateSchema.shape.threadTutors.element.shape.id,
    progress: z.record(TopicPartSchema.shape.id, PartProgressSchema.extend({
      // Covered meant encountered, so it must not become a claim of completed understanding.
      status: z.enum(["active", "covered", "completed"]).transform((status) => {
        if (status === "covered") return "active" as const
        return status
      }),
    })),
  })),
}).transform((state) => TopicStateSchema.parse({ ...state, type: "topic" }))

export const StoredScratchpadStateSchema = z.union([ScratchpadStateSchema, LegacyTopicStateSchema])
export const StoredTopicSchema = TopicSchema.extend({ state: StoredScratchpadStateSchema.optional() })
export const StoredWorkspaceSchema = WorkspaceSchema.extend({ topics: z.array(StoredTopicSchema) })
