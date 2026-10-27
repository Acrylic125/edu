import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import type { WorkerJob } from "../shared/contracts"
import { BatchReceiptSchema, RoleJobSchema, RoleRequestSchema, RoleRequestsSchema, RoleSummarySchema } from "../shared/tutor-workflow"
import { ScratchpadMutationSchema, scratchpadReferences } from "../shared/scratchpad-state"
import { createTutorSession } from "./tutor"
import { createTopicHandles, mapTopicReferenceIds, TopicHandleSchema } from "./topic-handles"
import { scratchpadToolDefinitions } from "./scratchpad-tools"
import { createTopicPlannerSession } from "./topic-planner"
import { scratchpadContext, selectTutorTopicIds } from "./tutor-evidence"
import { readSkillCatalog, teachingSkills } from "./tutor-skills"
import { TopicPartIdSchema } from "../shared/topic-state"
import { visualizationInstructions } from "../shared/visualization"
import { chatTeachingInstructions } from "./chat-teaching"

const DelegateSchema = z.object({ requests: RoleRequestsSchema }).strict()

export async function createWorkflowTutorSession(job: WorkerJob, batches: z.infer<typeof BatchReceiptSchema>[], summary: string, activity: (message: string) => void, priorMutations: z.infer<typeof ScratchpadMutationSchema>[] = []) {
  const base = await createTutorSession(job, activity, undefined, { priorMutations, skillPaths: teachingSkills })
  const handles = createTopicHandles(job)
  const handoff = structuredClone(job.chat.learning)
  if (handoff.pendingCheck) handoff.pendingCheck.scratchpadId = handles.referenceHandle(handoff.pendingCheck.scratchpadId)
  const catalog = await readSkillCatalog(job.skillDirectory, teachingSkills)
  const focusedIds = new Set(selectTutorTopicIds(job.chat, job.openedScratchpadId, job.confirmScratchpadId))
  const directory = [...new Map([...job.workspaceScratchpads, ...job.scratchpads].map((scratchpad) => [scratchpad.id, scratchpad])).values()].filter((scratchpad) => focusedIds.has(scratchpad.id)).map((scratchpad) => ({
    handle: handles.handle(scratchpad.id), type: scratchpad.state?.type ?? "topic", title: scratchpad.title, archived: scratchpad.archived,
    writable: job.scratchpads.some((target) => target.id === scratchpad.id && !target.archived),
    materials: (scratchpad.materials ?? []).map(({ id, name, kind, pages }) => ({ id, name, kind, pageCount: pages.length || 1 })),
    sourceScratchpads: scratchpad.state?.type === "test" ? [...new Set(scratchpadReferences(scratchpad.state).flatMap((reference) => reference.type === "topic" ? [handles.referenceHandle(reference.id)] : []))] : [],
  }))
  const allowed = new Set(["read_skill", "read_material", "list_scratchpads", "save_learning_state", "assume_role"])
  const tools: ChatCompletionTool[] = base.tools.filter((tool) => tool.type === "function" && allowed.has(tool.function.name)).map((tool) => {
    if (tool.type === "function" && tool.function.name === "read_skill") return {
      type: "function", function: { ...tool.function, parameters: z.toJSONSchema(z.object({ path: z.enum(teachingSkills) })) },
    }
    return tool
  })
  tools.push({ type: "function", function: { name: "assume_role", description: "Delegate a bounded scratchpad task. Supply independent jobs in one batch; dependent tasks require later batches. End this invocation after requesting delegation. The graph runs roles and commits their work before continuing this conversation.", parameters: z.toJSONSchema(DelegateSchema) } })
  const completion = Promise.withResolvers<void>()
  let requests: z.infer<typeof RoleRequestSchema>[] | undefined
  const session = {
    ...base,
    completion: completion.promise,
    instructions: handles.modelText(`Tutor the learner in this ongoing conversation. Use teaching skills and material tools to explain, check understanding, and give feedback.
Read a skill with read_skill when its description matches this task. Skill catalog: ${JSON.stringify(catalog)}
${visualizationInstructions}
${chatTeachingInstructions}
Use read_material for supplied sources. Cite the source pages used with edu-material://id/page and display requested source figures with edu-source://id/page.
Identify intent, requested scope, and learner level before requesting creation. Clarify missing information instead of creating an unspecified topic. For explicit creation, delegate planning directly without reading all attachments first. Include the agreed scope in the task. Creation needs an ordered curriculum and source references only. Do not request detailed definitions, worked solutions, or tutorial question mapping; reserve practice sources for later practice. Delegate all scratchpad reads and writes with assume_role. Choose the stored role for existing targets; infer topic, test, or generic for creation. Task text cannot grant access. Request only the messages, materials, and read dependencies the task needs. Use scratchpad_N handles. Never delegate to native subagents or shell tools.
The directory contains only current targets. Use list_scratchpads to discover other handles on demand. For a new test, grant topic readDependencies for the learner's named scope. For an all-covered test, list_scratchpads with type=topic and follow nextOffset to grant the full requested scope; the role discovers teaching coverage through summaries. Existing tests keep their sourceScratchpads unless the learner requests a change.
Creation always requires requestedAccess=write on the new target. Use readDependencies to read source scratchpads. For a single independent write task that can complete the learner turn, set replyToLearner=true. The role saves a private handoff and writes the learner reply; the host publishes it after commit. Leave it false for read tasks, multiple jobs, or work requiring later coordination.
For slide-based teaching, grant the target's relevant material IDs from the directory and the learner messages needed to continue the lesson. Include the requested source scope in the task. The reply role must continue the saved source position and teach the current source content in chat.
After assume_role, end this invocation without a learner reply. The graph checkpoints the requests, runs the roles, and commits before resuming Tutor. Only committed summaries and evidence return here.
After a topic plan commits, present its sections and save phase awaiting_plan_confirmation with no pending question or answer key. Save the private handoff with save_learning_state before a final learner reply. Use pendingCheck to refer to recorded checks. Keep answer keys private. A topic plan needs learner confirmation before teaching. Continue the learner's original request after delegation; keep workflow details out of the lesson.
Chat ID: ${job.chat.id}
Conversation message IDs: ${JSON.stringify(job.chat.messages.map(({ id, role }) => ({ id, role })))}
Creation requested: ${job.chat.scratchpadRequested}. Opened scratchpad: ${job.openedScratchpadId ? handles.handle(job.openedScratchpadId) : "none"}.
Private chat handoff: ${JSON.stringify(handoff)}
Conversation summary: ${summary}
Scratchpad directory: ${JSON.stringify(directory)}
Committed role results: ${JSON.stringify(batches)}
Chat materials: ${JSON.stringify(job.chat.materials.map(({ id, name, kind, pages }) => ({ id, name, kind, pageCount: pages.length || 1 })))}`),
    tools,
    async execute(name: string, input: Parameters<typeof base.execute>[1]) {
      try {
        if (!allowed.has(name)) throw new Error("This tool is not available to Tutor. Delegate scratchpad work with assume_role.")
        if (requests) throw new Error("Delegation has been requested. End this invocation so the graph can run it.")
        if (name === "read_skill") z.object({ path: z.enum(teachingSkills) }).parse(input)
        if (name === "assume_role") {
          requests = DelegateSchema.parse(input).requests
          completion.resolve()
          return { success: true, text: "Delegation requested. End this invocation now; the graph will commit the batch before continuing Tutor.", images: [] }
        }
        return base.execute(name, input)
      } catch (error) {
        return { success: false, text: error instanceof Error ? error.message : "Invalid tool arguments.", images: [] }
      }
    },
    get saved() { return requests !== undefined || base.saved },
    get saveError() { if (!requests) return base.saveError },
    hasReply(reply: string) { return requests !== undefined || base.hasReply(reply) },
    previewReply(reply: string) { if (requests) return ""; return base.previewReply(reply) },
    finish(reply = "") {
      if (requests) return { reply: "", learning: job.chat.learning, scratchpadUpdates: [], scratchpadMutations: [] }
      return base.finish(reply)
    },
  }
  return { session, get requests() { return requests } }
}

export async function createWorkflowRoleSession(source: WorkerJob, role: z.infer<typeof RoleJobSchema>, persist: (mutation: z.infer<typeof ScratchpadMutationSchema>) => Promise<void>, activity: (message: string) => void, recordRead?: (id: string, firstPage: number, lastPage: number) => Promise<void>) {
  const handles = createTopicHandles(source)
  const readIds = new Set(role.request.context.readDependencies.map((handle) => handles.resolve(handle, false)))
  readIds.add(role.scratchpadId)
  const materialIds = new Set(role.request.context.materialIds)
  const scoped = structuredClone(source)
  const available = [...role.dependencies, ...(role.snapshot ? [role.snapshot] : [])]
  if (role.handleIds.length) scoped.chat.scratchpadHandles = role.handleIds
  scoped.scratchpads = []
  if (role.snapshot && role.access === "write") scoped.scratchpads = [{ ...role.snapshot, assetDirectory: source.scratchpads.find((scratchpad) => scratchpad.id === role.scratchpadId)?.assetDirectory ?? source.assetDirectory }]
  scoped.workspaceScratchpads = available.filter((scratchpad) => readIds.has(scratchpad.id) && !scoped.scratchpads.some((target) => target.id === scratchpad.id)).map((scratchpad) => ({
    ...scratchpad, notes: scratchpad.learning.notes,
    assetDirectory: source.scratchpads.find((item) => item.id === scratchpad.id)?.assetDirectory ?? source.workspaceScratchpads.find((item) => item.id === scratchpad.id)?.assetDirectory,
  }))
  scoped.chat.messages = source.chat.messages.filter((message) => role.request.context.learnerMessageIds.includes(message.id))
    .map((message) => ({ ...message, materialIds: message.materialIds?.filter((id) => materialIds.has(id)) }))
  scoped.chat.learning = { ...source.chat.learning, phase: "ready_to_continue", outline: [], currentSection: "", pendingQuestion: "", pendingCheck: undefined, responseQuestion: undefined, privateAnswerKey: "", notes: "", workpad: "", nextAction: role.request.task }
  const focusedIds = selectTutorTopicIds(source.chat, source.openedScratchpadId, source.confirmScratchpadId)
  const continuesChat = role.request.replyToLearner === true && role.access === "write" && role.mode === "existing" && focusedIds.includes(role.scratchpadId)
    && (!source.chat.learning.pendingCheck || source.chat.learning.pendingCheck.scratchpadId === role.scratchpadId)
  let chatInstructions = ""
  if (role.request.replyToLearner && role.access === "write") chatInstructions = chatTeachingInstructions
  if (continuesChat) {
    scoped.chat.learning = structuredClone(source.chat.learning)
    const handoff = structuredClone(scoped.chat.learning)
    if (handoff.pendingCheck) handoff.pendingCheck.scratchpadId = role.scratchpadHandle
    chatInstructions += `\nPrivate chat handoff: ${JSON.stringify(handoff)}`
  }
  const learnerChoice = source.chat.messages.findLast((message) => message.role === "user")?.content.trim()
  const practiceChosen = continuesChat && role.role === "topic" && source.chat.learning.phase === "awaiting_choice"
    && source.chat.learning.responseQuestion?.options.some((option) => /practice/i.test(option) && option === learnerChoice)
  const practicedParts = new Set<string>()
  if (practiceChosen && role.snapshot?.state?.type === "topic") {
    const progress = role.snapshot.state.threadTutors.find((thread) => thread.id === source.chat.id)?.progress ?? {}
    for (const [partId, part] of Object.entries(progress)) {
      if (part.steps.length) practicedParts.add(partId)
    }
    chatInstructions += "\nThe learner selected practice. Stay on the already taught part. Source an eligible practice question, or honestly explain the sourcing limitation and save awaiting_choice with Proceed and Keep looking for practice. Wait for a new choice before starting the next part."
  }
  scoped.chat.scratchpadRequested = false
  scoped.chat.providerSession = undefined
  scoped.chat.materials = source.chat.materials.filter((material) => materialIds.has(material.id))
  // Existing source blocks need their material metadata to render, even when the role cannot read those materials.
  const materialDirectory = [...new Map([
    ...scoped.chat.materials,
    ...scoped.scratchpads.flatMap((scratchpad) => scratchpad.materials),
    ...scoped.workspaceScratchpads.flatMap((scratchpad) => scratchpad.materials ?? []),
  ].map((material) => [material.id, material])).values()].filter((material) => materialIds.has(material.id)).map(({ id, name, kind, pages }) => ({
    id, name, kind, pageCount: pages.length || 1, referencePath: `assets/${name}`,
    reviewedPages: role.readEvidence.filter((entry) => entry.materialId === id).map((entry) => entry.page).sort((left, right) => left - right),
  }))
  scoped.openedScratchpadId = undefined
  scoped.confirmScratchpadId = undefined
  if (role.role === "topic" && role.access === "write" && (role.mode === "create" || !role.snapshot?.planConfirmed))
    return createTopicPlannerSession(scoped, role, { creationId: role.scratchpadId, operations: role.operations.map((operation) => operation.mutation), persist, readEvidence: role.readEvidence, recordRead }, activity)
  const skillPaths = [`skills/MANAGE_${role.role.toUpperCase()}.md`, ...teachingSkills,
    `scratchpad_templates/${role.role}/schema.md`, `scratchpad_templates/${role.role}/tools.md`, `scratchpad_templates/${role.role}/scratchpad_${role.role}.md`]
  let hasWrites = role.operations.length > 0
  const base = await createTutorSession(scoped, activity, undefined, { creationId: role.scratchpadId, operations: role.operations.map((operation) => operation.mutation), persist: async (mutation) => {
    await persist(mutation)
    hasWrites = true
  }, readEvidence: role.readEvidence, recordRead, skillPaths })
  const management = await readFile(join(source.skillDirectory, skillPaths[0]), "utf8")
  const catalog = await readSkillCatalog(source.skillDirectory, teachingSkills)
  const roleTools = scratchpadToolDefinitions.filter((tool) => {
    if (tool.role !== role.role || (tool.writer && role.access !== "write") || (tool.creation && role.mode !== "create")) return false
    return true
  })
  const completion = Promise.withResolvers<void>()
  let phaseInstructions = ""
  if (role.role === "topic" && role.access === "write")
    phaseInstructions = "Read the specific source pages needed for the current explanation or question. Check reviewedPages in Granted materials and read only the missing pages needed now. Recording an answer, activating a part, or updating progress does not require rereading its full curriculum reference range. Explicit source blocks must cite pages read in this invocation."
  else if (role.role === "topic")
    phaseInstructions = "Read the assigned topic state and return a concise summary with finish_role. Do not create, revise, or teach the topic."
  let recoveryInstructions = ""
  if (role.operations.length)
    recoveryInstructions = `Earlier staged writes are already applied to ${role.scratchpadHandle}. Read its current state with read_scratchpad before changing it. Preserve those writes instead of recreating the scratchpad. Reviewed pages remain verified; reread only sources needed to complete or change the task.`
  const allowed = new Set(["read_skill", "read_material", "read_scratchpad", "read_topic_evidence", "finish_role", ...roleTools.map((tool) => tool.name)])
  if (role.role === "test") allowed.add("test_getCoveredTopics")
  if (role.request.replyToLearner && role.access === "write") allowed.add("save_learning_state")
  const tools: ChatCompletionTool[] = base.tools.filter((tool) => tool.type === "function" && allowed.has(tool.function.name)).map((tool) => {
    if (tool.type === "function" && tool.function.name === "read_skill") return { type: "function", function: { ...tool.function, parameters: z.toJSONSchema(z.object({ path: z.enum(skillPaths) })) } }
    return tool
  })
  tools.push({ type: "function", function: { name: "finish_role", description: "Finish this bounded task with a concise summary and source evidence. The host validates and commits the staged work.", parameters: z.toJSONSchema(RoleSummarySchema.omit({ response: true }), {
    override({ jsonSchema }) {
      const properties = jsonSchema.properties
      if (properties?.type && typeof properties.type === "object" && properties.type.const === "topic" && properties.id)
        properties.id = z.toJSONSchema(TopicHandleSchema)
    },
  }) } })
  let output: z.infer<typeof RoleSummarySchema> | undefined
  function creationError() {
    if (role.mode !== "create" || hasWrites) return
    if (base.saved && base.clarificationQuestion?.trim()) return
    return "Create the assigned scratchpad before reporting completion, or save phase awaiting_clarification with the specific missing information in question. Summary-only roles must use finish_role with needsClarification=true when creation is blocked."
  }
  const session = {
    ...base,
    completion: completion.promise,
    instructions: `Complete this ${role.role} scratchpad task with the supplied role tools.\n${management}\nRead the matching skill with read_skill when needed. Skill catalog: ${JSON.stringify(catalog)}\nRole references available through read_skill: ${JSON.stringify(skillPaths.filter((path) => !path.startsWith("skills/")))}\nTask: ${role.request.task}\nRelevant context: ${role.request.context.relevantContext}\nTarget: ${role.scratchpadHandle}; access: ${role.access}; mode: ${role.mode}.\n${phaseInstructions}\n${chatInstructions}\n${recoveryInstructions}\nUse only this target for writes. Read dependencies: ${JSON.stringify(role.request.context.readDependencies)}. For summary tasks, call finish_role when done. Reply to learner: ${role.request.replyToLearner === true}. When true, complete the assigned work, save_learning_state, and write a normal learner-facing reply so it streams. The host commits before publication. Summary tasks return only summary and evidence; their previews remain hidden.\nFile references must use the exact referencePath below, including assets/. Material IDs are for read_material and source blocks, not file reference paths.\nCurrent thread: ${scoped.chat.id}. Use only scratchpad_N handles. read_topic_evidence retrieves section history on demand. Source reads remain limited to Granted materials. Cite used pages with edu-material://id/page and requested figures with edu-source://id/page. ${visualizationInstructions}\nCurrent target: ${JSON.stringify(role.snapshot && { title: role.snapshot.title, planConfirmed: role.snapshot.planConfirmed, ...scratchpadContext(role.snapshot, scoped.chat) })}\nGranted materials: ${JSON.stringify(materialDirectory)}`,
    tools,
    async execute(name: string, input: Parameters<typeof base.execute>[1]) {
      try {
        if (!allowed.has(name)) throw new Error("This tool is not granted to the assigned role.")
        if (output && name !== "finish_role") throw new Error("This role is ready. End the invocation.")
        if (practiceChosen && ["topic_activatePart", "topic_recordQuestion"].includes(name)) {
          const { scratchpadPartId } = z.object({ scratchpadPartId: TopicPartIdSchema }).parse(input)
          if (!practicedParts.has(scratchpadPartId))
            throw new Error("The learner selected practice. Stay within previously assessed parts; if no sourced practice is available, explain the limitation and wait for a new choice before proceeding.")
        }
        if (name === "read_skill") z.object({ path: z.enum(skillPaths) }).parse(input)
        if (name === "read_material") {
          const { id } = z.object({ id: z.string() }).parse(input)
          if (!materialIds.has(id)) throw new Error("This material is not granted to the role.")
        }
        if (name === "read_scratchpad") {
          const { scratchpadId } = z.object({ scratchpadId: z.string() }).parse(input)
          let id = role.scratchpadId
          if (scratchpadId !== role.scratchpadHandle) id = handles.resolve(scratchpadId, false)
          if (!readIds.has(id)) throw new Error("This scratchpad is not granted to the role.")
        }
        if (name === "finish_role") {
          if (output) return { success: true, text: "Role already ready for host validation and commit.", images: [] }
          const candidate = RoleSummarySchema.omit({ response: true }).parse(mapTopicReferenceIds(z.json().parse(input), (handle) => {
            if (handle === role.scratchpadHandle) return role.scratchpadId
            const id = handles.resolve(handle, false)
            if (!readIds.has(id)) throw new Error("Evidence must refer to a granted scratchpad.")
            return id
          }))
          if (candidate.needsCoordination) {
            if (role.mode !== "existing" || hasWrites || candidate.needsClarification)
              throw new Error("Return a request for coordination only from an existing-target role before making any writes.")
            output = candidate
            completion.resolve()
            return { success: true, text: "Request returned to Tutor for coordination. End this invocation.", images: [] }
          }
          if (role.mode === "create" && !hasWrites && base.saved && base.clarificationQuestion?.trim()) {
            candidate.needsClarification = true
          }
          if (candidate.needsClarification && hasWrites) throw new Error("A clarification result cannot include staged writes. Complete the staged task and save its learner reply instead.")
          if (!candidate.needsClarification) {
            const error = creationError()
            if (error) throw new Error(error)
          }
          if (base.saveError && !candidate.needsClarification) throw new Error(base.saveError)
          if (role.request.replyToLearner && !candidate.needsClarification) {
            if (!base.saved || !base.hasReply("")) throw new Error("Save the handoff and write a normal learner reply, or select stored lesson blocks before finish_role.")
            output = { ...candidate, response: base.finish("") }
          } else output = candidate
          completion.resolve()
          return { success: true, text: "Role ready for host validation and commit. End the invocation.", images: [] }
        }
        const result = await base.execute(name, input)
        return result
      } catch (error) {
        return { success: false, text: error instanceof Error ? error.message : "Invalid tool arguments.", images: [] }
      }
    },
    get saved() { return output !== undefined || (role.request.replyToLearner === true && base.saved && !creationError()) },
    get saveError() { if (!output?.needsClarification) return base.saveError ?? creationError() },
    hasReply(reply: string) { return output !== undefined || (role.request.replyToLearner === true && base.hasReply(reply)) },
    previewReply(reply: string) { if (role.request.replyToLearner) return base.previewReply(reply); return "" },
    recoveryMessage() {
      return [base.saveError ?? creationError() ?? "", phaseInstructions, recoveryInstructions, "Complete the assigned task and call finish_role with its summary and evidence. Repair rejected writes only with tools allowed in the current phase."].filter((text) => text.length > 0).join("\n")
    },
    finish(reply = "") {
      if (!output && role.request.replyToLearner) {
        const error = creationError()
        if (error) throw new Error(error)
        const response = base.finish(reply)
        if (role.mode === "create" && !hasWrites) {
          // A valid clarification handoff returns to Tutor without claiming a nonexistent scratchpad.
          output = { summary: response.reply, evidence: [], needsClarification: true }
        } else {
          output = { summary: `Completed ${role.role} task.`, evidence: [{ type: "topic", id: role.scratchpadId }], response }
        }
      }
      if (!output) throw new Error("The role did not finish its task.")
      if (output.response) return { ...output.response, scratchpadUpdates: [], scratchpadMutations: [] }
      return { reply: output.summary, learning: scoped.chat.learning, scratchpadUpdates: [], scratchpadMutations: [] }
    },
  }
  return { job: scoped, session, get output() { return output } }
}
