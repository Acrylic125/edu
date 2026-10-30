import { z } from "zod"

export const AppUpdateSchema = z.object({
  version: z.string(),
  enabled: z.boolean(),
  phase: z.enum(["idle", "checking", "available", "downloading", "downloaded", "installing"]),
  latestVersion: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  checkedAt: z.string().optional(),
  error: z.string().optional(),
})
