import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { WorkflowHost } from "../main/tutor-workflow"
import { BatchReceiptSchema, CompleteOutputSchema, ConversationSummarySchema, PreparedContextSchema, RoleBatchSchema, TurnReceiptSchema, WorkflowRecordSchema, WorkflowRequestSchema, WorkflowResponseSchema } from "../shared/tutor-workflow"

export function createWorkflowClient(attemptId: string, send: (message: { type: "workflow_request"; requestId: string; attemptId: string; request: z.infer<ReturnType<typeof z.json>> }) => void) {
  const pending = new Map<string, { resolve: (value: z.infer<ReturnType<typeof z.json>>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const call = <Schema extends z.ZodType>(request: z.infer<typeof WorkflowRequestSchema>, schema: Schema) => new Promise<z.output<Schema>>((resolve, reject) => {
    const requestId = randomUUID()
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("The workflow host did not respond.")) }, 60_000)
    pending.set(requestId, { timer, reject, resolve(value) { try { resolve(schema.parse(value)) } catch (error) { reject(error) } } })
    send({ type: "workflow_request", requestId, attemptId, request: z.json().parse(JSON.parse(JSON.stringify(request))) })
  })
  const host: WorkflowHost = {
    get: (chatId, turnId) => call({ operation: "get", chatId, turnId }, WorkflowRecordSchema),
    beginInvocation: async (chatId, turnId, invocationId) => { await call({ operation: "beginInvocation", chatId, turnId, invocationId }, z.null()) },
    endInvocation: async (chatId, turnId, invocationId, completed) => { await call({ operation: "endInvocation", chatId, turnId, invocationId, completed }, z.null()) },
    assumeRole: (chatId, turnId, tutorStepId, requests) => call({ operation: "assumeRole", chatId, turnId, tutorStepId, requests }, RoleBatchSchema),
    stage: async (chatId, turnId, jobId, operationId, mutation) => { await call({ operation: "stage", chatId, turnId, jobId, operationId, mutation }, z.null()) },
    recordRead: async (chatId, turnId, jobId, materialId, firstPage, lastPage) => { await call({ operation: "recordRead", chatId, turnId, jobId, materialId, firstPage, lastPage }, z.null()) },
    ready: async (chatId, turnId, jobId, output) => { await call({ operation: "ready", chatId, turnId, jobId, output }, z.null()) },
    commitBatch: (chatId, turnId, batchId) => call({ operation: "commitBatch", chatId, turnId, batchId }, BatchReceiptSchema),
    presentPlan: (chatId, turnId, batchId) => call({ operation: "presentPlan", chatId, turnId, batchId }, CompleteOutputSchema),
    saveHandoff: (chatId, turnId, tutorStepId, learning, providerSession) => call({ operation: "saveHandoff", chatId, turnId, tutorStepId, learning, providerSession }, z.string().uuid()),
    saveReply: (chatId, turnId, reply, handoffRef) => call({ operation: "saveReply", chatId, turnId, reply, handoffRef }, TurnReceiptSchema),
    complete: (chatId, turnId) => call({ operation: "complete", chatId, turnId }, CompleteOutputSchema),
    saveContext: (chatId, turnId, context) => call({ operation: "saveContext", chatId, turnId, context }, PreparedContextSchema),
    saveSummary: (chatId, turnId, sourceMessageIds, summary) => call({ operation: "saveSummary", chatId, turnId, sourceMessageIds, summary }, ConversationSummarySchema),
  }
  return {
    host,
    receive(input: z.infer<typeof WorkflowResponseSchema>) {
      const request = pending.get(input.requestId)
      if (!request) return
      pending.delete(input.requestId)
      clearTimeout(request.timer)
      if (input.error) request.reject(new Error(input.error))
      else request.resolve(input.result ?? null)
    },
    close() {
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error("The workflow connection closed."))
      }
      pending.clear()
    },
  }
}
