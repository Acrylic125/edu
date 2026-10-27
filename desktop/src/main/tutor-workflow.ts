import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { copyFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { CompleteOutputSchema, PreparedContextSchema, RoleBatchSchema, RoleJobSchema, RoleRequestSchema, RoleRequestsSchema, RoleSummarySchema, WorkflowRecordSchema, WorkflowRequestSchema } from "../shared/tutor-workflow"
import { LearningStateSchema, MessageSchema, ProviderSessionSchema, type WorkerJob } from "../shared/contracts"
import type { WorkspaceRepository } from "./workspace"
import { newChat } from "./workspace"
import { stripTopicMentions } from "../shared/topic-mentions"
import { createTopicHandles } from "../runners/topic-handles"
import { applyScratchpadMutation } from "./state-service"
import { ScratchpadMutationSchema } from "../shared/scratchpad-state"
import { scratchpadToolDefinitions } from "../runners/scratchpad-tools"
import { committedSource } from "../runners/workflow-context"
import { parseScratchpadCommand } from "../shared/scratchpad-commands"
import { nativeProcessIdentity, reconcileNativeProcesses } from "./native-process"

function scratchpadVersion(snapshot: z.infer<typeof RoleJobSchema>["snapshot"]) {
  let content = null
  if (snapshot) content = { state: snapshot.state, notes: snapshot.learning.notes, archived: snapshot.archived, planConfirmed: snapshot.planConfirmed, materials: snapshot.materials }
  return createHash("sha256").update(JSON.stringify(content)).digest("hex")
}

export class TutorWorkflowRepository {
  constructor(private workspace: WorkspaceRepository) {}

  async start(job: WorkerJob) {
    const request = job.chat.messages.at(-1)
    if (!request || request.role !== "user") throw new Error("The current learner request is missing.")
    const turn = WorkflowRecordSchema.parse({
      turnId: randomUUID(), attemptId: randomUUID(), chatId: job.chat.id, learnerMessageId: request.id,
      status: "running", source: job,
      summary: this.workspace.conversationSummary(job.chat.id),
    })
    await this.workspace.saveWorkflow(turn)
    return this.workspace.mutateWorkflow(turn.turnId, (turn, state) => {
      const chat = state.chats.find((chat) => chat.id === turn.chatId)
      if (!chat) throw new Error("Chat not found.")
      if (chat.activeTurnId) throw new Error("This chat already has an active turn.")
      chat.activeTurnId = turn.turnId
      chat.failedTurnId = undefined
      chat.turnError = undefined
    })
  }

  get(chatId: string, turnId: string) {
    const turn = WorkflowRecordSchema.parse(this.workspace.workflow(turnId))
    if (turn.chatId !== chatId) throw new Error("This turn does not belong to this chat.")
    return turn
  }

  async redirectCreation(chatId: string, turnId: string, input: z.infer<typeof RoleRequestSchema>[]) {
    const current = this.get(chatId, turnId)
    if (current.redirectedTurnId) return this.workspace.workflow(current.redirectedTurnId)
    const requests = RoleRequestsSchema.parse(input)
    if (!current.source.chat.ownerScratchpadId || !requests.some((request) => request.target.mode === "create")) return
    const message = current.source.chat.messages.find((message) => message.id === current.learnerMessageId)
    if (!message) throw new Error("The creation request is missing.")
    const staged = newChat(current.source.runner.id, stripTopicMentions(message.content).slice(0, 80))
    staged.scratchpadRequested = true
    staged.messages = [structuredClone(message)]
    staged.scratchpadHandles = [...current.source.chat.scratchpadHandles]
    const materials = [...current.source.chat.materials, ...current.source.scratchpads.flatMap((scratchpad) => scratchpad.materials)]
    staged.materials = [...new Map(materials.filter((material) => message.materialIds?.includes(material.id)).map((material) => [material.id, material])).values()]
    const assetDirectory = join(this.workspace.directory, "chats", staged.id, "assets")
    if (staged.materials.length) {
      await mkdir(assetDirectory, { recursive: true })
      for (const material of staged.materials) {
        let sourceDirectory = current.source.assetDirectory
        if (!current.source.chat.materials.some((item) => item.id === material.id)) {
          const scratchpad = current.source.scratchpads.find((scratchpad) => scratchpad.materials.some((item) => item.id === material.id))
          if (!scratchpad?.assetDirectory) throw new Error("The request attachment is unavailable.")
          sourceDirectory = scratchpad.assetDirectory
        }
        await copyFile(join(sourceDirectory, material.name), join(assetDirectory, material.name), constants.COPYFILE_EXCL)
      }
    }
    const moved = WorkflowRecordSchema.parse({
      turnId: randomUUID(), attemptId: randomUUID(), chatId: staged.id, learnerMessageId: message.id, status: "failed",
      source: { ...current.source, chat: staged, confirmScratchpadId: undefined, assetDirectory },
    })
    staged.failedTurnId = moved.turnId
    // Save a resumable destination before removing the request from its original conversation.
    await this.workspace.saveWorkflow(moved)
    await this.workspace.mutateWorkflow(turnId, (turn, state) => {
      const chat = state.chats.find((chat) => chat.id === chatId)
      if (!chat || chat.activeTurnId !== turnId || turn.status !== "running") throw new Error("The creation request is no longer active.")
      chat.movedRequests.push({
        messageId: message.id,
        messageIndex: chat.messages.findIndex((message) => message.id === turn.learnerMessageId),
        chatId: staged.id,
      })
      chat.messages = chat.messages.filter((message) => message.id !== turn.learnerMessageId)
      chat.activeTurnId = undefined
      chat.failedTurnId = undefined
      chat.turnError = undefined
      turn.status = "failed"
      turn.error = "This request moved to Staging."
      turn.redirectedTurnId = moved.turnId
      turn.attemptId = randomUUID()
      state.chats.push(staged)
    })
    return this.workspace.workflow(moved.turnId)
  }

  async assumeRole(chatId: string, turnId: string, tutorStepId: string, input: z.infer<typeof RoleRequestSchema>[]) {
    this.get(chatId, turnId)
    const requests = RoleRequestsSchema.parse(input)
    const turn = await this.workspace.updateWorkflow(turnId, (turn) => {
      if (turn.batches.some((batch) => batch.tutorStepId === tutorStepId)) return
      const source = committedSource(turn)
      const handles = createTopicHandles({ ...source, apiKey: "" })
      const jobs = requests.map((request) => {
        if (request.context.learnerMessageIds.some((id) => !source.chat.messages.some((message) => message.id === id)))
          throw new Error("The role requested a message outside its pinned context.")
        const dependencies = request.context.readDependencies.map((handle) => this.workspace.scratchpad(handles.resolve(handle, false)))
        let scratchpadId: string = randomUUID()
        let snapshot: z.infer<typeof RoleJobSchema>["snapshot"] = null
        let role = request.target.mode === "create" ? request.target.type : "topic"
        if (request.target.mode === "existing") {
          scratchpadId = handles.resolve(request.target.scratchpadHandle, request.requestedAccess === "write")
          snapshot = structuredClone(this.workspace.scratchpad(scratchpadId))
          role = snapshot.state?.type ?? "topic"
        } else {
          if (request.requestedAccess !== "write") throw new Error("Creation requires write access.")
          const command = parseScratchpadCommand(turn.source.chat.messages.at(-1)?.content ?? "")
          if (command && command.type !== role) throw new Error(`${command.command} requires the matching creation role.`)
          handles.register(scratchpadId)
        }
        const materials = [...source.chat.materials, ...(snapshot?.materials ?? []), ...dependencies.flatMap((scratchpad) => scratchpad.materials)]
        if (request.context.materialIds.some((id) => !materials.some((material) => material.id === id)))
          throw new Error("The role requested a material outside its granted sources.")
        return RoleJobSchema.parse({
          jobId: randomUUID(), stageId: randomUUID(), scratchpadId, scratchpadHandle: handles.handle(scratchpadId),
          role, access: request.requestedAccess, mode: request.target.mode,
          baseVersion: snapshot && scratchpadVersion(snapshot), snapshot, dependencies, request, operations: [],
        })
      })
      const handleIds = [...new Set([...source.chat.scratchpadHandles, ...source.scratchpads.map((scratchpad) => scratchpad.id), ...source.workspaceScratchpads.map((scratchpad) => scratchpad.id), ...jobs.filter((job) => job.mode === "create").map((job) => job.scratchpadId)])]
      for (const job of jobs) job.handleIds = handleIds
      const writes = jobs.filter((job) => job.access === "write").map((job) => job.scratchpadId)
      if (new Set(writes).size !== writes.length) throw new Error("Writes to the same scratchpad must run in later batches.")
      for (const job of jobs) {
        const reads = new Set([job.scratchpadId, ...job.dependencies.map((scratchpad) => scratchpad.id)])
        if (jobs.some((other) => other.jobId !== job.jobId && other.access === "write" && reads.has(other.scratchpadId)))
          throw new Error("Dependent tasks must run in a later batch after their prerequisite commits.")
      }
      turn.batches.push(RoleBatchSchema.parse({ batchId: randomUUID(), tutorStepId, jobs }))
    })
    return turn.batches.find((batch) => batch.tutorStepId === tutorStepId)!
  }

  async stage(chatId: string, turnId: string, jobId: string, operationId: string, input: z.infer<typeof ScratchpadMutationSchema>) {
    this.get(chatId, turnId)
    const mutation = ScratchpadMutationSchema.parse(input)
    await this.workspace.updateWorkflow(turnId, (turn) => {
      const job = turn.batches.flatMap((batch) => batch.jobs).find((job) => job.jobId === jobId)
      if (!job || job.status !== "working") throw new Error("This role stage is not writable.")
      if (job.access !== "write" || mutation.scratchpadId !== job.scratchpadId) throw new Error("This role cannot write that scratchpad.")
      const tool = scratchpadToolDefinitions.find((tool) => tool.writer && tool.operation === mutation.type)
      if (!tool || tool.role !== job.role) throw new Error("This mutation does not belong to the assigned scratchpad role.")
      if (tool.creation && job.mode !== "create") throw new Error("An existing scratchpad role cannot create another target.")
      if (job.role === "topic" && !job.snapshot?.planConfirmed && mutation.type !== "createTopic" && mutation.type !== "updateTopic")
        throw new Error("The topic plan requires learner confirmation before teaching or recording questions.")
      const existing = job.operations.find((operation) => operation.operationId === operationId)
      if (existing) {
        if (JSON.stringify(existing.mutation) !== JSON.stringify(mutation)) throw new Error("A logical operation cannot change on replay.")
        return
      }
      const candidate = { scratchpads: [...turn.source.scratchpads], chats: [turn.source.chat] }
      candidate.scratchpads = candidate.scratchpads.filter((scratchpad) => scratchpad.id !== job.scratchpadId)
      if (job.snapshot) candidate.scratchpads.push({ ...job.snapshot, assetDirectory: turn.source.assetDirectory })
      const staged = structuredClone(candidate)
      for (const operation of job.operations) applyScratchpadMutation(staged, chatId, operation.mutation)
      applyScratchpadMutation(staged, chatId, mutation)
      job.operations.push({ operationId, mutation })
    })
  }

  async ready(chatId: string, turnId: string, jobId: string, output: z.infer<typeof RoleSummarySchema>) {
    this.get(chatId, turnId)
    await this.workspace.updateWorkflow(turnId, (turn) => {
      const job = turn.batches.flatMap((batch) => batch.jobs).find((job) => job.jobId === jobId)
      if (!job) throw new Error("Role job not found.")
      if (output.response && (!job.request.replyToLearner || job.access !== "write" || output.needsClarification || output.needsCoordination))
        throw new Error("This role is not granted a direct learner reply.")
      // Planning replies and handoffs are generated by presentPlan after the staged curriculum commits.
      const planning = job.role === "topic" && job.access === "write" && !job.snapshot?.planConfirmed
      if (job.request.replyToLearner && !planning && !output.response && !output.needsClarification && !output.needsCoordination)
        throw new Error("The role must supply its completed learner reply and handoff.")
      if (job.mode === "create" && !job.operations.length && !output.needsClarification) throw new Error("The creation role has not staged its scratchpad.")
      if (output.needsClarification && job.operations.length) throw new Error("A clarification result cannot include staged writes.")
      if (output.needsCoordination && (job.mode !== "existing" || job.operations.length || output.needsClarification))
        throw new Error("Only an existing-target role without staged writes can return a request for coordination.")
      job.output = RoleSummarySchema.parse(output)
      job.status = "ready"
    })
  }

  async recordRead(chatId: string, turnId: string, jobId: string, materialId: string, firstPage: number, lastPage: number) {
    this.get(chatId, turnId)
    await this.workspace.updateWorkflow(turnId, (turn) => {
      const job = turn.batches.flatMap((batch) => batch.jobs).find((job) => job.jobId === jobId)
      if (!job || job.status !== "working" || !job.request.context.materialIds.includes(materialId)) throw new Error("This source read is not granted to the role.")
      const material = [...turn.source.chat.materials, ...(job.snapshot?.materials ?? []), ...job.dependencies.flatMap((scratchpad) => scratchpad.materials)].find((material) => material.id === materialId)
      if (!material || firstPage < 1 || !Number.isInteger(firstPage) || !Number.isInteger(lastPage) || lastPage < firstPage || lastPage > (material.pages.length || 1)) throw new Error("The read evidence is outside the source.")
      for (let page = firstPage; page <= lastPage; page++) {
        if (!job.readEvidence.some((entry) => entry.materialId === materialId && entry.page === page)) job.readEvidence.push({ materialId, page })
      }
    })
  }

  async commitBatch(chatId: string, turnId: string, batchId: string) {
    this.get(chatId, turnId)
    const turn = await this.workspace.mutateWorkflow(turnId, (turn, state) => {
      const batch = turn.batches.find((batch) => batch.batchId === batchId)
      if (!batch) throw new Error("Batch not found.")
      if (batch.receipt) return
      for (const job of batch.jobs) {
        if (job.status !== "ready" || !job.output) throw new Error("Every required role must be ready before committing.")
        const current = state.scratchpads.find((scratchpad) => scratchpad.id === job.scratchpadId) ?? null
        if (job.mode === "existing" && scratchpadVersion(current) !== job.baseVersion) throw new Error("Scratchpad changed since this role started. Correct the revision conflict before retrying.")
        if (job.mode === "create" && current) throw new Error("The allocated scratchpad identity is already in use.")
        for (const dependency of job.dependencies) {
          const latest = state.scratchpads.find((scratchpad) => scratchpad.id === dependency.id) ?? null
          if (scratchpadVersion(latest) !== scratchpadVersion(dependency)) throw new Error("A read dependency changed during this role task. Correct the revision conflict before retrying.")
        }
        for (const operation of job.operations) applyScratchpadMutation(state, chatId, operation.mutation)
        job.committedSnapshot = state.scratchpads.find((scratchpad) => scratchpad.id === job.scratchpadId)
        job.status = "committed"
      }
      const ownerId = state.chats.find((chat) => chat.id === chatId)?.ownerScratchpadId
      if (ownerId) {
        for (const chat of state.chats) {
          for (const request of chat.movedRequests) {
            if (request.chatId === chatId) request.scratchpadId = ownerId
          }
        }
      }
      batch.receipt = {
        receiptId: randomUUID(), batchId, committedAt: new Date().toISOString(),
        results: batch.jobs.map((job) => {
          const { response: _response, ...summary } = RoleSummarySchema.parse(job.output)
          return { ...summary, jobId: job.jobId,
            scratchpadId: job.scratchpadId, scratchpadHandle: job.scratchpadHandle, role: job.role,
            version: scratchpadVersion(state.scratchpads.find((scratchpad) => scratchpad.id === job.scratchpadId) ?? null),
          }
        }),
      }
    })
    return turn.batches.find((batch) => batch.batchId === batchId)!.receipt!
  }

  async presentPlan(chatId: string, turnId: string, batchId: string, durationMs?: number) {
    const turn = this.get(chatId, turnId)
    if (turn.receipt) return this.complete(chatId, turnId)
    const batch = turn.batches.find((batch) => batch.batchId === batchId)
    if (!batch?.receipt || !batch.jobs.every((job) => job.role === "topic" && job.access === "write" && !job.snapshot?.planConfirmed))
      throw new Error("Only committed topic planning work can produce a plan confirmation.")
    const plans = batch.jobs.flatMap((job) => job.committedSnapshot?.state?.type === "topic" ? [job.committedSnapshot] : [])
    const questions = batch.jobs.flatMap((job) => job.output?.needsClarification ? [job.output.summary] : [])
    const escape = (text: string) => text.replace(/[\\`*_[\]<>]/g, "\\$&")
    const replies = plans.map((scratchpad) => {
      if (scratchpad.state?.type !== "topic") throw new Error("A topic plan is required.")
      const parts = scratchpad.state.content.map((part, index) => {
        const goals = part.goals.map((goal) => escape(goal.objective)).join("; ")
        const citations = part.references.map((reference) => {
          if (reference.type === "website") return `[Source](${reference.url})`
          if (reference.type === "topic") return `[Related topic](edu-topic://${reference.id})`
          const material = scratchpad.materials.find((material) => `assets/${material.name}` === reference.path)
          if (!material) throw new Error("The plan source is missing from its topic.")
          if (reference.type === "pdf" || reference.type === "ppt") {
            const pages = reference.pages.map((range) => range.from === range.to ? `${range.from}` : `${range.from}–${range.to}`).join(", ")
            return `[Source, pages ${pages}](edu-material://${material.id}/${reference.pages[0].from})`
          }
          return `[Source](edu-material://${material.id}/1)`
        }).join(" · ")
        return `${index + 1}. ${escape(part.name)}${goals ? `: ${goals}` : ""} ${citations}`
      })
      return `**${escape(scratchpad.title)}**\n\n${parts.join("\n")}`
    })
    let reply = questions.join("\n\n")
    if (plans.length) reply = `${replies.join("\n\n")}\n\nConfirm this plan to begin, or tell me what to change.`
    const learning = LearningStateSchema.parse({ ...turn.source.chat.learning,
      phase: plans.length ? "awaiting_plan_confirmation" : "awaiting_clarification",
      outline: plans.flatMap((scratchpad) => scratchpad.state?.type === "topic" ? scratchpad.state.content.map((part) => part.name) : []).slice(0, 100),
      currentSection: "", pendingQuestion: plans.length ? "" : questions.join("\n\n"), pendingCheck: undefined, responseQuestion: undefined, privateAnswerKey: "",
      nextAction: plans.length ? "Wait for learner confirmation before teaching." : "Wait for the missing scope or source information.",
      workpad: plans.length ? "The committed topic plan is awaiting learner confirmation. No lesson or check has been generated." : questions.join("\n\n"),
    })
    const handoff = await this.saveHandoff(chatId, turnId, batch.tutorStepId, learning)
    await this.saveReply(chatId, turnId, reply, handoff, durationMs)
    return this.complete(chatId, turnId)
  }

  async presentRoleReply(chatId: string, turnId: string, batchId: string, durationMs?: number) {
    const turn = this.get(chatId, turnId)
    if (turn.receipt) return this.complete(chatId, turnId)
    const batch = turn.batches.find((batch) => batch.batchId === batchId)
    const job = batch?.jobs[0]
    const response = job?.output?.response
    if (!batch?.receipt || batch.jobs.length !== 1 || !job?.request.replyToLearner || !response)
      throw new Error("A committed independent role reply is required.")
    const handoff = await this.saveHandoff(chatId, turnId, job.jobId, response.learning)
    await this.saveReply(chatId, turnId, response.reply, handoff, durationMs)
    return this.complete(chatId, turnId)
  }

  async saveHandoff(chatId: string, turnId: string, tutorStepId: string, input: z.infer<typeof LearningStateSchema>, providerSession?: z.infer<typeof ProviderSessionSchema>) {
    const current = this.get(chatId, turnId)
    const learning = LearningStateSchema.parse(input)
    if (current.batches.some((batch) => batch.jobs.some((job) => job.role === "topic" && job.access === "write" && job.committedSnapshot && !job.committedSnapshot.planConfirmed))) {
      if (learning.phase !== "awaiting_plan_confirmation" || learning.pendingQuestion || learning.pendingCheck || learning.responseQuestion || learning.privateAnswerKey)
        throw new Error("Present the saved topic plan for learner confirmation without generating a question or answer key.")
    }
    const turn = await this.workspace.updateWorkflow(turnId, (turn) => {
      if (providerSession) turn.providerSession = ProviderSessionSchema.parse(providerSession)
      const existing = turn.handoffs.find((handoff) => handoff.tutorStepId === tutorStepId)
      if (existing) existing.learning = learning
      else turn.handoffs.push({ handoffId: randomUUID(), tutorStepId, learning, batchIds: turn.batches.map((batch) => batch.batchId) })
    })
    return turn.handoffs.find((handoff) => handoff.tutorStepId === tutorStepId)!.handoffId
  }

  async saveReply(chatId: string, turnId: string, reply: string, handoffRef: string, durationMs?: number) {
    this.get(chatId, turnId)
    const content = MessageSchema.shape.content.trim().min(1).parse(reply)
    const turn = await this.workspace.mutateWorkflow(turnId, (turn, state) => {
      if (turn.receipt) {
        if (turn.receipt.handoffRef !== handoffRef) throw new Error("The turn already published a different handoff.")
        return
      }
      if (turn.batches.some((batch) => !batch.receipt)) throw new Error("Every required batch must commit before saving the reply.")
      const handoff = turn.handoffs.find((handoff) => handoff.handoffId === handoffRef)
      if (!handoff || JSON.stringify(handoff.batchIds) !== JSON.stringify(turn.batches.map((batch) => batch.batchId)))
        throw new Error("Save a current, verified Tutor handoff before replying.")
      const chat = state.chats.find((chat) => chat.id === chatId)
      if (!chat) throw new Error("Chat not found.")
      const createdIds = turn.batches.flatMap((batch) => batch.jobs.filter((job) => job.mode === "create" && job.committedSnapshot).map((job) => job.scratchpadId))
      const message = MessageSchema.parse({ id: randomUUID(), role: "assistant", content, durationMs,
        createdAt: new Date().toISOString(), responseQuestion: handoff.learning.responseQuestion, scratchpadIds: createdIds,
      })
      if (!chat.titleGenerated && createdIds.length) {
        const scratchpad = state.scratchpads.find((scratchpad) => scratchpad.id === createdIds[0] && scratchpad.state?.type === "topic")
        if (scratchpad) { chat.title = scratchpad.title; chat.titleGenerated = true }
      }
      chat.learning = handoff.learning
      chat.providerSession = turn.providerSession
      chat.scratchpadHandles = [...new Set([...chat.scratchpadHandles, ...createdIds])]
      if (createdIds.length) chat.scratchpadRequested = false
      chat.messages.push(message)
      if (chat.activeTurnId === turnId) chat.activeTurnId = undefined
      if (chat.failedTurnId === turnId) chat.failedTurnId = undefined
      chat.turnError = undefined
      turn.receipt = { receiptId: randomUUID(), messageId: message.id, handoffRef,
        committedBatchReceiptIds: turn.batches.map((batch) => batch.receipt!.receiptId), committedAt: message.createdAt,
      }
      turn.status = "completed"
    })
    return turn.receipt!
  }

  complete(chatId: string, turnId: string) {
    const turn = this.get(chatId, turnId)
    if (!turn.receipt || turn.status !== "completed") throw new Error("A verified turn receipt is required for completion.")
    const message = this.workspace.chat(chatId).messages.find((message) => message.id === turn.receipt?.messageId)
    return CompleteOutputSchema.parse({ receipt: turn.receipt, message })
  }

  async saveContext(chatId: string, turnId: string, input: z.infer<typeof PreparedContextSchema>) {
    this.get(chatId, turnId)
    const context = PreparedContextSchema.parse(input)
    const turn = await this.workspace.updateWorkflow(turnId, (turn) => {
      if (!turn.contexts.some((saved) => saved.key === context.key)) turn.contexts.push(context)
    })
    return turn.contexts.find((saved) => saved.key === context.key)!
  }

  async saveSummary(chatId: string, turnId: string, sourceMessageIds: string[], summary: string) {
    const turn = this.get(chatId, turnId)
    const last = sourceMessageIds.at(-1)
    if (!last) throw new Error("Compaction needs a source message range.")
    if (turn.summary?.coveredThroughMessageId === last) return turn.summary
    const coveredIndex = turn.source.chat.messages.findIndex((message) => message.id === turn.summary?.coveredThroughMessageId)
    const endIndex = turn.source.chat.messages.findIndex((message) => message.id === last)
    const expected = turn.source.chat.messages.slice(coveredIndex + 1, endIndex + 1).map((message) => message.id)
    if (endIndex >= turn.source.chat.messages.length - 1 || JSON.stringify(sourceMessageIds) !== JSON.stringify(expected))
      throw new Error("Compaction must cover a contiguous pinned history range before the current request.")
    return this.workspace.saveWorkflowSummary(turnId, { summaryId: randomUUID(), chatId,
      coveredThroughMessageId: last, sourceMessageIds, summary, createdAt: new Date().toISOString(),
    })
  }

  async fail(chatId: string, turnId: string, error: string) {
    this.get(chatId, turnId)
    return this.workspace.mutateWorkflow(turnId, (turn, state) => {
      if (turn.receipt) return
      turn.status = "failed"
      turn.error = error
      const chat = state.chats.find((chat) => chat.id === chatId)
      if (!chat) throw new Error("Chat not found.")
      if (chat.activeTurnId === turnId) chat.activeTurnId = undefined
      chat.failedTurnId = turnId
      chat.turnError = error
    })
  }

  async retry(chatId: string, turnId: string) {
    const previous = this.get(chatId, turnId)
    if (previous.redirectedTurnId) throw new Error("This request moved to Staging.")
    await reconcileNativeProcesses(previous.nativeProcesses)
    if (previous.nativeInvocations.some((invocation) => ["active", "uncertain"].includes(invocation.status) && !invocation.registered))
      throw new Error("A native attempt has unresolved status. Reconcile that attempt before retrying.")
    return this.workspace.mutateWorkflow(turnId, (turn, state) => {
      if (turn.status !== "failed" || turn.receipt) throw new Error("Only a failed, unfinished turn can be retried.")
      const chat = state.chats.find((chat) => chat.id === chatId)
      if (!chat || chat.activeTurnId) throw new Error("This chat already has an active turn.")
      turn.status = "running"
      turn.error = undefined
      turn.attemptId = randomUUID()
      for (const invocation of turn.nativeInvocations) if (invocation.status !== "completed") invocation.status = "reconciled"
      chat.activeTurnId = turnId
      chat.failedTurnId = undefined
      chat.turnError = undefined
    })
  }

  async beginInvocation(chatId: string, turnId: string, invocationId: string) {
    this.get(chatId, turnId)
    await this.workspace.updateWorkflow(turnId, (turn) => {
      if (turn.status !== "running") throw new Error("This turn is not running.")
      const existing = turn.nativeInvocations.find((invocation) => invocation.invocationId === invocationId)
      if (existing && ["active", "uncertain"].includes(existing.status)) throw new Error("This native invocation must be reconciled before restarting.")
      turn.nativeInvocations = turn.nativeInvocations.filter((invocation) => invocation.invocationId !== invocationId)
      turn.nativeInvocations.push({ invocationId, attemptId: turn.attemptId, status: "active", registered: false })
    })
  }

  async endInvocation(chatId: string, turnId: string, invocationId: string, completed: boolean) {
    this.get(chatId, turnId)
    await this.workspace.updateWorkflow(turnId, (turn) => {
      const invocation = turn.nativeInvocations.find((invocation) => invocation.invocationId === invocationId)
      if (!invocation) throw new Error("Native invocation not found.")
      invocation.status = completed ? "completed" : "uncertain"
    })
  }

  async nativeStarted(chatId: string, turnId: string, invocationId: string, pid: number) {
    this.get(chatId, turnId)
    const identity = await nativeProcessIdentity(pid)
    await this.workspace.updateWorkflow(turnId, (turn) => {
      const invocation = turn.nativeInvocations.find((invocation) => invocation.invocationId === invocationId)
      if (!invocation) return
      invocation.registered = true
      if (identity && !turn.nativeProcesses.some((record) => record.pid === pid && record.identity === identity))
        turn.nativeProcesses.push({ invocationId, pid, identity })
    })
  }

  async recoverInterruptedTurns() {
    for (const chat of this.workspace.stateSnapshot.chats) {
      if (!chat.activeTurnId) continue
      const turn = this.get(chat.id, chat.activeTurnId)
      await this.fail(chat.id, turn.turnId, "The app closed before this turn completed. Retry to continue the saved workflow.")
      try { await reconcileNativeProcesses(turn.nativeProcesses) } catch {
        // Retry repeats reconciliation and surfaces unresolved process status to the learner.
      }
    }
  }
}

type HostMethods = Pick<TutorWorkflowRepository, "get" | "assumeRole" | "stage" | "recordRead" | "ready" | "commitBatch" | "saveHandoff" | "saveReply" | "complete" | "saveContext" | "saveSummary" | "beginInvocation" | "endInvocation" | "presentPlan" | "presentRoleReply">
export type WorkflowHost = { [Method in keyof HostMethods]: (...args: Parameters<HostMethods[Method]>) => Promise<Awaited<ReturnType<HostMethods[Method]>>> | ReturnType<HostMethods[Method]> }

export function dispatchWorkflowRequest(repository: TutorWorkflowRepository, request: z.infer<typeof WorkflowRequestSchema>, durationMs?: number) {
  const { chatId, turnId } = request
  switch (request.operation) {
    case "get": return repository.get(chatId, turnId)
    case "beginInvocation": return repository.beginInvocation(chatId, turnId, request.invocationId)
    case "endInvocation": return repository.endInvocation(chatId, turnId, request.invocationId, request.completed)
    case "assumeRole": return repository.assumeRole(chatId, turnId, request.tutorStepId, request.requests)
    case "stage": return repository.stage(chatId, turnId, request.jobId, request.operationId, request.mutation)
    case "recordRead": return repository.recordRead(chatId, turnId, request.jobId, request.materialId, request.firstPage, request.lastPage)
    case "ready": return repository.ready(chatId, turnId, request.jobId, request.output)
    case "commitBatch": return repository.commitBatch(chatId, turnId, request.batchId)
    case "presentPlan": return repository.presentPlan(chatId, turnId, request.batchId, durationMs)
    case "presentRoleReply": return repository.presentRoleReply(chatId, turnId, request.batchId, durationMs)
    case "saveHandoff": return repository.saveHandoff(chatId, turnId, request.tutorStepId, request.learning, request.providerSession)
    case "saveReply": return repository.saveReply(chatId, turnId, request.reply, request.handoffRef, durationMs)
    case "complete": return repository.complete(chatId, turnId)
    case "saveContext": return repository.saveContext(chatId, turnId, request.context)
    case "saveSummary": return repository.saveSummary(chatId, turnId, request.sourceMessageIds, request.summary)
  }
}
