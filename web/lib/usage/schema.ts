import { z } from "zod"

const UsageBucketSchema = z.object({
  timestamp: z.iso.datetime(),
  requests: z.number().int().nonnegative(),
  responses: z.number().int().nonnegative(),
})

const UsagePeriodSchema = z.object({
  granularity: z.enum(["hour", "day", "month"]),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  buckets: z.array(UsageBucketSchema),
})

export const UsagePayloadSchema = z.object({
  generatedAt: z.iso.datetime(),
  periods: z.object({
    "1d": UsagePeriodSchema,
    "7d": UsagePeriodSchema,
    "1mo": UsagePeriodSchema,
    mtd: UsagePeriodSchema,
    ytd: UsagePeriodSchema,
  }),
})

export type UsagePayload = z.infer<typeof UsagePayloadSchema>
