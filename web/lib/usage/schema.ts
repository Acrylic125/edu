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
  subscription: z.object({
    plan: z.enum(["free", "pro"]),
    name: z.string(),
    aiRequestsPerMinute: z.number().int().positive(),
    allowances: z.array(z.object({
      metric: z.enum(["aiRequestsPerDay", "aiRequestsPerMonth", "uploadsPerMonth", "pdfPagesPerMonth", "storageBytes"]),
      used: z.number().nonnegative(),
      limit: z.number().nonnegative(),
      remaining: z.number().nonnegative(),
      resetAt: z.iso.datetime().nullable(),
    })),
  }),
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
