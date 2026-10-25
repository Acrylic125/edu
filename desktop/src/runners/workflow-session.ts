import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import type { WorkerJob } from "../shared/contracts"
import { BatchReceiptSchema, RoleJobSchema, RoleRequestSchema, RoleSummarySchema } from "../shared/tutor-workflow"
import { ScratchpadMutationSchema } from "../shared/scratchpad-state"
import { createTutorSession } from "./tutor"
import { createTopicHandles, mapTopicReferenceIds, TopicHandleSchema } from "./topic-handles"
import { scratchpadToolDefinitions } from "./scratchpad-tools"
import { createTopicPlannerSession } from "./topic-planner"

const teachingSkills = ["skills/FEEDBACK_AND_DELIBERATE.md", "skills/WHAT_IS_UNDERSTANDING.md", "skills/WRITING_STYLE.md", "skills/UNSLOP.md"] as const
const DelegateSchema = z.object({ requests: z.array(RoleRequestSchema).min(1).max(12) }).strict()

export async function createSingleTutorSession(job: WorkerJob, roles: z.infer<typeof RoleJobSchema>[], persist: (mutation: z.infer<typeof ScratchpadMutationSchema>) => Promise<void>, recordRead: (id: string, firstPage: number, lastPage: number) => Promise<void>, activity: (message: string) => void) {
  let writes = roles.reduce((count, role) => count + role.operations.length, 0)
  const base = await createTutorSession(job, activity, undefined, {
    operations: roles.flatMap((role) => role.operations.map((operation) => operation.mutation)), readEvidence: roles.flatMap((role) => role.readEvidence), recordRead,
    async persist(mutation) { await persist(mutation); writes += 1 },
  })
  const delegated = Promise.withResolvers<void>()
  let requests: z.infer<typeof RoleRequestSchema>[] | undefined
  const tools: ChatCompletionTool[] = base.tools.filter((tool) => {
    if (tool.type !== "function") return false
    const domain = scratchpadToolDefinitions.find((entry) => entry.name === tool.function.name)
    return !domain?.writer || (roles.some((role) => role.role === domain.role) && !domain.creation)
  })
  tools.push({ type: "function", function: { name: "assume_role", description: "Delegate creation of a new scratchpad before making changes to the current one. Complete ordinary teaching, reading, feedback, questions, and progress updates directly with the supplied tools.", parameters: z.toJSONSchema(DelegateSchema) } })
  const names = new Set(tools.flatMap((tool) => tool.type === "function" ? [tool.function.name] : []))
  const session = {
    ...base,
    tools,
    resumeProviderSession: true,
    completion: Promise.race([base.completion, delegated.promise]),
    instructions: `${base.instructions}\nComplete the learner's tutoring turn in this invocation: explain, evaluate answers, update the scratchpad, and ask the next dynamic check using the supplied tools. Do not delegate ordinary teaching or generate a separate role summary. Save the private handoff with save_learning_state. Write the chat explanation as a normal learner-facing response so it streams. Save new or revised topic walkthroughs separately with topic_editContent, following the scratchpad format in MANAGE_TOPIC.md. Omit present for these scratchpad edits so the chat keeps its own explanation. If the learner requests a new scratchpad, use assume_role before making changes to this one.`,
    async execute(name: string, input: Parameters<typeof base.execute>[1]) {
      try {
        if (requests) throw new Error("Creation has been delegated. End this invocation.")
        if (!names.has(name)) throw new Error("This tool is not granted to the current tutoring turn.")
        if (name === "assume_role") {
          if (writes) throw new Error("Finish the current tutoring changes before delegating a new scratchpad. Do not discard staged work.")
          const candidate = DelegateSchema.parse(input).requests
          if (candidate.some((request) => request.target.mode !== "create")) throw new Error("Use the supplied tools for teaching and reading existing scratchpads. Delegate only creation.")
          requests = candidate
          delegated.resolve()
          return { success: true, text: "Creation delegated. End this invocation.", images: [] }
        }
        const result = await base.execute(name, input)
        if (result.success && name === "save_learning_state" && base.hasReply("")) delegated.resolve()
        return result
      } catch (error) {
        return { success: false, text: error instanceof Error ? error.message : "Invalid tutoring operation.", images: [] }
      }
    },
    get saved() { return requests !== undefined || base.saved },
    get saveError() { if (!requests) return base.saveError },
    hasReply(reply: string) { return requests !== undefined || base.hasReply(reply) },
    previewReply(reply: string) { if (!requests) return base.previewReply(reply); return "" },
    finish(reply: string) {
      if (requests) return { reply: "", learning: job.chat.learning, topicUpdates: [], topicMutations: [] }
      return base.finish(reply)
    },
  }
  return { session, get requests() { return requests } }
}

export async function createWorkflowTutorSession(job: WorkerJob, batches: z.infer<typeof BatchReceiptSchema>[], summary: string, activity: (message: string) => void, priorMutations: z.infer<typeof ScratchpadMutationSchema>[] = []) {
  const base = await createTutorSession(job, activity, undefined, { priorMutations })
  const handles = createTopicHandles(job)
  const handoff = structuredClone(job.chat.learning)
  if (handoff.pendingCheck) handoff.pendingCheck.topicId = handles.referenceHandle(handoff.pendingCheck.topicId)
  const guides = await Promise.all(teachingSkills.map(async (path) => `${path}\n${await readFile(join(job.skillDirectory, path), "utf8")}`))
  const directory = [...new Map([...job.topics, ...job.workspaceTopics].map((topic) => [topic.id, topic])).values()].map((topic) => ({
    handle: handles.handle(topic.id), type: topic.state?.type ?? "topic", title: topic.title, archived: topic.archived,
    writable: job.topics.some((target) => target.id === topic.id && !target.archived),
  }))
  const allowed = new Set(["read_skill", "read_material", "save_learning_state", "assume_role"])
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
${guides.join("\n\n")}
${base.instructions.slice(base.instructions.indexOf("## Showing references in chat"), base.instructions.indexOf("## Scratchpad roles and tools"))}
Identify intent, requested scope, and learner level before requesting creation. Clarify missing information instead of creating an unspecified topic. For explicit creation, delegate planning directly without reading all attachments first. Include the agreed scope in the task. Creation needs an ordered curriculum and source references only. Do not request detailed definitions, worked solutions, or tutorial question mapping; keep practice sources for dynamic teaching. Delegate all scratchpad reads and writes with assume_role. Choose the stored role for existing targets; infer topic, test, or generic for creation. Task text cannot grant access. Request only the messages, materials, and read dependencies the task needs. Use scratchpad_N handles. Never delegate to native subagents or shell tools.
After assume_role, end this invocation without a learner reply. The graph checkpoints the requests, runs the roles, and commits before resuming Tutor. Only committed summaries and evidence return here.
After a topic plan commits, present its sections and save phase awaiting_plan_confirmation with no pending question or answer key. Save the private handoff with save_learning_state before a final learner reply. Use pendingCheck to refer to recorded checks. Keep answer keys private. A topic plan needs learner confirmation before teaching. Continue the learner's original request after delegation; keep workflow details out of the lesson.
Chat ID: ${job.chat.id}
Conversation message IDs: ${JSON.stringify(job.chat.messages.map(({ id, role }) => ({ id, role })))}
Creation requested: ${job.chat.scratchpadRequested}. Opened scratchpad: ${job.openedTopicId ? handles.handle(job.openedTopicId) : "none"}.
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
    finish(reply: string) {
      if (requests) return { reply: "", learning: job.chat.learning, topicUpdates: [], topicMutations: [] }
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
  if (role.handleIds.length) scoped.chat.topicHandles = role.handleIds
  scoped.topics = []
  if (role.snapshot && role.access === "write") scoped.topics = [{ ...role.snapshot, assetDirectory: source.topics.find((topic) => topic.id === role.scratchpadId)?.assetDirectory ?? source.assetDirectory }]
  scoped.workspaceTopics = available.filter((topic) => readIds.has(topic.id) && !scoped.topics.some((target) => target.id === topic.id)).map((topic) => ({
    ...topic, notes: topic.learning.notes,
    assetDirectory: source.topics.find((item) => item.id === topic.id)?.assetDirectory ?? source.workspaceTopics.find((item) => item.id === topic.id)?.assetDirectory,
  }))
  scoped.chat.messages = source.chat.messages.filter((message) => role.request.context.learnerMessageIds.includes(message.id))
    .map((message) => ({ ...message, materialIds: message.materialIds?.filter((id) => materialIds.has(id)) }))
  scoped.chat.learning = { ...source.chat.learning, phase: "ready_to_continue", outline: [], currentSection: "", pendingQuestion: "", pendingCheck: undefined, responseQuestion: undefined, privateAnswerKey: "", notes: "", workpad: "", nextAction: role.request.task }
  scoped.chat.scratchpadRequested = false
  scoped.chat.providerSession = undefined
  scoped.chat.materials = source.chat.materials.filter((material) => materialIds.has(material.id))
  // Existing source blocks need their material metadata to render, even when the role cannot read those materials.
  const materialDirectory = [...new Map([
    ...scoped.chat.materials,
    ...scoped.topics.flatMap((topic) => topic.materials),
    ...scoped.workspaceTopics.flatMap((topic) => topic.materials ?? []),
  ].map((material) => [material.id, material])).values()].filter((material) => materialIds.has(material.id)).map(({ id, name, kind, pages }) => ({
    id, name, kind, pageCount: pages.length || 1, referencePath: `assets/${name}`,
    reviewedPages: role.readEvidence.filter((entry) => entry.materialId === id).map((entry) => entry.page).sort((left, right) => left - right),
  }))
  scoped.openedTopicId = undefined
  scoped.confirmTopicId = undefined
  if (role.role === "topic" && role.access === "write" && (role.mode === "create" || !role.snapshot?.planConfirmed))
    return createTopicPlannerSession(scoped, role, { creationId: role.scratchpadId, operations: role.operations.map((operation) => operation.mutation), persist, readEvidence: role.readEvidence, recordRead }, activity)
  const base = await createTutorSession(scoped, activity, undefined, { creationId: role.scratchpadId, operations: role.operations.map((operation) => operation.mutation), persist, readEvidence: role.readEvidence, recordRead })
  const skillPaths = [`skills/MANAGE_${role.role.toUpperCase()}.md`, "skills/UNSLOP.md", "skills/WRITING_STYLE.md",
    `scratchpad_templates/${role.role}/schema.md`, `scratchpad_templates/${role.role}/tools.md`, `scratchpad_templates/${role.role}/scratchpad_${role.role}.md`]
  const guides = await Promise.all(skillPaths.map(async (path) => `${path}\n${await readFile(join(source.skillDirectory, path), "utf8")}`))
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
  const allowed = new Set(["read_skill", "read_material", "read_scratchpad", "finish_role", ...roleTools.map((tool) => tool.name)])
  if (role.role === "test") allowed.add("test_getCoveredTopics")
  const tools: ChatCompletionTool[] = base.tools.filter((tool) => tool.type === "function" && allowed.has(tool.function.name)).map((tool) => {
    if (tool.type === "function" && tool.function.name === "read_skill") return { type: "function", function: { ...tool.function, parameters: z.toJSONSchema(z.object({ path: z.enum(skillPaths) })) } }
    return tool
  })
  tools.push({ type: "function", function: { name: "finish_role", description: "Finish this bounded task with a concise summary and source evidence. The host validates and commits the staged work.", parameters: z.toJSONSchema(RoleSummarySchema, {
    override({ jsonSchema }) {
      const properties = jsonSchema.properties
      if (properties?.type && typeof properties.type === "object" && properties.type.const === "topic" && properties.id)
        properties.id = z.toJSONSchema(TopicHandleSchema)
    },
  }) } })
  let output: z.infer<typeof RoleSummarySchema> | undefined
  const session = {
    ...base,
    completion: completion.promise,
    instructions: `Complete this ${role.role} scratchpad task with the supplied role tools.\n${guides.join("\n\n")}\nTask: ${role.request.task}\nRelevant context: ${role.request.context.relevantContext}\nTarget: ${role.scratchpadHandle}; access: ${role.access}; mode: ${role.mode}.\n${phaseInstructions}\n${recoveryInstructions}\nUse only this target for writes. Read dependencies: ${JSON.stringify(role.request.context.readDependencies)}. For non-planning tasks, use finish_role when done. Do not save a Tutor handoff or produce a learner lesson.\nFile references must use the exact referencePath below, including assets/. Material IDs are for read_material and source blocks, not file reference paths.\n${base.instructions.slice(base.instructions.indexOf("Current thread:"), base.instructions.indexOf("- threadTutors"))}\nCurrent target: ${JSON.stringify(role.snapshot && { title: role.snapshot.title, state: role.snapshot.state, notes: role.snapshot.learning.notes, planConfirmed: role.snapshot.planConfirmed })}\nGranted materials: ${JSON.stringify(materialDirectory)}`,
    tools,
    async execute(name: string, input: Parameters<typeof base.execute>[1]) {
      try {
        if (!allowed.has(name)) throw new Error("This tool is not granted to the assigned role.")
        if (output && name !== "finish_role") throw new Error("This role is ready. End the invocation.")
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
          const candidate = RoleSummarySchema.parse(mapTopicReferenceIds(z.json().parse(input), (handle) => {
            if (handle === role.scratchpadHandle) return role.scratchpadId
            const id = handles.resolve(handle, false)
            if (!readIds.has(id)) throw new Error("Evidence must refer to a granted scratchpad.")
            return id
          }))
          if (base.saveError && !candidate.needsClarification) throw new Error(base.saveError)
          output = candidate
          completion.resolve()
          return { success: true, text: "Role ready for host validation and commit. End the invocation.", images: [] }
        }
        const result = await base.execute(name, input)
        return result
      } catch (error) {
        return { success: false, text: error instanceof Error ? error.message : "Invalid tool arguments.", images: [] }
      }
    },
    get saved() { return output !== undefined },
    get saveError() { if (!output?.needsClarification) return base.saveError },
    hasReply() { return output !== undefined },
    previewReply() { return "" },
    recoveryMessage() {
      return [base.saveError ?? "", phaseInstructions, recoveryInstructions, "Complete the assigned task and call finish_role with its summary and evidence. Repair rejected writes only with tools allowed in the current phase."].filter((text) => text.length > 0).join("\n")
    },
    finish() {
      if (!output) throw new Error("The role did not finish its task.")
      return { reply: output.summary, learning: scoped.chat.learning, topicUpdates: [], topicMutations: [] }
    },
  }
  return { job: scoped, session, get output() { return output } }
}
