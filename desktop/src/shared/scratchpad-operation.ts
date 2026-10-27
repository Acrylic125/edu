import { createHash } from "node:crypto"
import type { z } from "zod"
import type { ScratchpadMutationSchema } from "./scratchpad-state"

export function scratchpadOperationId(stageId: string, mutation: z.infer<typeof ScratchpadMutationSchema>) {
  const logical = { ...mutation, createdAt: undefined, expectedRevision: undefined, expectedState: undefined, expectedContent: undefined, expectedSummary: undefined }
  return createHash("sha256").update(`${stageId}:${JSON.stringify(logical)}`).digest("hex")
}
