import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import {
  copyFile,
  cp,
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"
import {
  providerDefaultModels,
  LearningStateSchema,
  ChatSchema,
  LegacyWorkspaceSchema,
  MaterialSchema,
  PublicChatSchema,
  PublicTopicSchema,
  TopicSchema,
  WorkspaceSchema,
  IdSchema,
  type Topic,
  type Workspace,
} from "../shared/contracts"
import { topicDirectoryMarkdown } from "../shared/topic-directory"
import { z } from "zod"
import { ChatDatabase } from "./chat-database"
import { freshTopicState, ScratchpadNameSchema } from "../shared/topic-state"
import { ScratchpadStateSchema, ScratchpadTypeSchema, scratchpadReferences } from "../shared/scratchpad-state"
import { StoredScratchpadStateSchema, StoredTopicSchema, StoredWorkspaceSchema } from "./workspace-migrations"
import { importStructuredContent } from "./structured-content-migration"
import { scratchpadMarkdown } from "../shared/scratchpad-markdown"
import { ConversationSummarySchema, WorkflowRecordSchema } from "../shared/tutor-workflow"

const SettingsSchema = WorkspaceSchema.pick({ runners: true, providerSettings: true }).extend({
  version: z.literal(3),
})
const LegacyTopicStateSchema = StoredTopicSchema.omit({ id: true, title: true, learning: true }).extend({
  learning: z.object(LearningStateSchema.shape).omit({ notes: true, workpad: true }),
})
const TopicHeaderSchema = ScratchpadNameSchema

async function readOptionalFile(path: string) {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
}

async function writeAtomic(path: string, content: string) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { mode: 0o600 })
    if (await readFile(temporary, "utf8") !== content)
      throw new Error(`Could not verify saved file: ${path}`)
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function writeMaterialManifest(topicDirectory: string, material: z.infer<typeof MaterialSchema>) {
  const directory = join(topicDirectory, "assets", "cache", "prepared", material.id)
  await mkdir(directory, { recursive: true })
  await writeAtomic(join(directory, "manifest.json"), JSON.stringify(material))
}

async function readMaterialManifests(topicDirectory: string) {
  const prepared = join(topicDirectory, "assets", "cache", "prepared")
  let entries: string[] = []
  try {
    entries = await readdir(prepared)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
  const materials: z.infer<typeof MaterialSchema>[] = []
  for (const id of entries) {
    if (!IdSchema.safeParse(id).success) continue
    const raw = await readOptionalFile(join(prepared, id, "manifest.json"))
    if (raw === undefined) continue
    const material = MaterialSchema.parse(JSON.parse(raw))
    if (material.id !== id) throw new Error(`Material ID does not match its cache folder: ${id}`)
    materials.push(material)
  }
  return materials.sort((left, right) => left.name.localeCompare(right.name))
}

function topicNotes(title: string, notes: string) {
  const body = notes.replace(/^\s*# [^\r\n]*(?:\r?\n|$)/, "").trimStart()
  return `# ${TopicHeaderSchema.parse(title.replace(/\s+/g, " "))}\n\n${body}`
}

export class WorkspaceRepository {
  private state: Workspace = WorkspaceSchema.parse({ version: 2, runners: [], topics: [], chats: [] })
  private writes = Promise.resolve()

  private database: ChatDatabase

  constructor(readonly directory: string) {
    this.database = new ChatDatabase(join(directory, "state.sqlite"))
  }

  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    const saved = this.database.load()
    await chmod(this.database.path, 0o600)
    if (!saved || saved.needsMigration)
      await this.migrateLegacyTopicFolders(saved?.state.topics.map((topic) => topic.id))
    if (saved) {
      this.state = saved.state
      if (saved.filesPending) {
        await this.syncFiles(this.state, WorkspaceSchema.parse({ version: 2, runners: [], topics: [], chats: [] }))
        await this.removeRecoveredFiles(saved.removedFiles)
        this.database.filesSynced()
      }
      this.state = { ...this.state, topics: await this.readTopics() }
      if (saved.needsMigration) await this.commit(this.state)
      await this.pruneObsoleteFiles()
      return this.state
    }
    const settings = await readOptionalFile(join(this.directory, "settings.json"))
    const legacyPath = join(this.directory, "workspace.json")
    if (settings !== undefined) {
      this.state = WorkspaceSchema.parse({
        ...SettingsSchema.parse(JSON.parse(settings)),
        version: 2,
        topics: await this.readTopics(),
        chats: await this.readChats(),
      })
      await this.commit(this.state)
    } else {
      const raw = await readOptionalFile(legacyPath)
      let state = WorkspaceSchema.parse({ version: 2, runners: [], topics: [], chats: [] })
      if (raw !== undefined) {
        const stored = z
          .discriminatedUnion("version", [StoredWorkspaceSchema, LegacyWorkspaceSchema.extend({
            topics: z.array(StoredTopicSchema.extend({ runnerId: IdSchema, messages: z.array(LegacyWorkspaceSchema.shape.topics.element.shape.messages.element) })),
          })])
          .parse(JSON.parse(raw))
        if (stored.version === 2) {
          state = stored
        } else {
          const chats = stored.topics
            .filter((topic) => topic.messages.length > 0)
            .map((topic) => ({
              ...newChat(topic.runnerId, topic.title),
              titleGenerated: true,
              createdAt: topic.createdAt,
              messages: topic.messages.map((message) => ({
                ...message,
                topicIds: [topic.id],
              })),
            }))
          state = WorkspaceSchema.parse({ ...stored, version: 2, chats })
        }
      } else {
        state.topics = await this.readTopics()
        state.chats = await this.readChats()
        state.runners.push({
          id: randomUUID(),
          name: "Tutor",
          provider: "codex",
          model: providerDefaultModels.codex,
        })
      }
      await this.commit(state)
      // Keep the legacy transaction until every migrated topic and chat can be read back.
      this.state = WorkspaceSchema.parse({ ...this.state, topics: await this.readTopics(), chats: this.database.load()?.state.chats ?? [] })
    }
    await this.pruneObsoleteFiles()
    return this.state
  }

  private async migrateLegacyTopicFolders(topicIds?: string[]) {
    const root = join(this.directory, "topics")
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !IdSchema.safeParse(entry.name).success) continue
      if (topicIds && !topicIds.includes(entry.name)) continue
      const source = join(root, entry.name)
      const notes = await readOptionalFile(join(source, "topic.md"))
      if (notes === undefined) continue
      const destination = join(this.directory, "scratchpads", entry.name)
      if (await readOptionalFile(join(destination, "scratchpad.md")) !== undefined) continue
      const rawState = await readOptionalFile(join(source, "topic.state.json"))
      let state
      if (rawState !== undefined) state = StoredScratchpadStateSchema.parse(JSON.parse(rawState))
      const temporary = `${destination}.${randomUUID()}.tmp`
      try {
        // Publish the complete copy atomically; original topic folders remain recoverable.
        await cp(source, temporary, { recursive: true, preserveTimestamps: true })
        await rename(join(temporary, "topic.md"), join(temporary, "scratchpad.md"))
        if (state) await writeAtomic(join(temporary, "scratchpad.state.json"), JSON.stringify(state, null, 2))
        await rename(temporary, destination)
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    }
  }

  private async pruneObsoleteFiles() {
    const saved = this.database.load()
    if (!saved || saved.filesPending) throw new Error("Workspace cleanup requires a verified database commit.")
    const settings = WorkspaceSchema.pick({ runners: true, providerSettings: true })
    const chats = (state: Workspace) => [...state.chats].sort((left, right) => left.id.localeCompare(right.id))
    if (
      JSON.stringify(chats(saved.state)) !== JSON.stringify(chats(this.state)) ||
      JSON.stringify(settings.parse(saved.state)) !== JSON.stringify(settings.parse(this.state))
    ) throw new Error("The saved workspace did not pass cleanup verification.")

    for (const name of ["workspace.json", "workspace.legacy.json", "settings.json"])
      await rm(join(this.directory, name), { force: true })
    const directories = [this.directory]
    for (const collection of ["topics", "chats"] as const) {
      const root = join(this.directory, collection === "topics" ? "scratchpads" : collection)
      await mkdir(root, { recursive: true })
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !IdSchema.safeParse(entry.name).success) continue
        const directory = join(root, entry.name)
        if (collection === "chats") {
          if (!saved.state.chats.some((chat) => chat.id === entry.name)) {
            await rm(directory, { recursive: true, force: true })
            continue
          }
          await rm(join(directory, "chat.json"), { force: true })
        }
        directories.push(directory)
      }
    }
    // Only remove temporary files produced by our atomic writer, leaving learner files and assets untouched.
    for (const directory of directories) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        const match = /^(?:workspace\.json|settings\.json|chat\.json|topic\.json|scratchpad\.state\.json|scratchpad\.md|agent\.workpad\.md)\.(.+)\.tmp$/.exec(entry.name)
        if (match && IdSchema.safeParse(match[1]).success)
          await rm(join(directory, entry.name), { force: true })
      }
    }
  }

  private async readTopics() {
    const root = join(this.directory, "scratchpads")
    await mkdir(root, { recursive: true })
    const topics: Topic[] = []
    // Topic and test JSON owns content; Markdown is a rebuildable projection.
    const savedTopics = this.database.load()?.state.topics ?? []
    const archivedIds = new Set(savedTopics.filter((topic) => topic.archived).map((topic) => topic.id))
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !IdSchema.safeParse(entry.name).success) continue
      const directory = join(root, entry.name)
      const markdown = await readOptionalFile(join(directory, "scratchpad.md"))
      const structured = await readOptionalFile(join(directory, "scratchpad.state.json"))
      if (markdown === undefined && structured === undefined) continue
      const storedState = structured === undefined ? undefined : StoredScratchpadStateSchema.parse(JSON.parse(structured))
      const notes = markdown ?? ""
      let title = storedState?.name
      if (!storedState || storedState.type === "generic") title = /^\s*# ([^\r\n]+)/.exec(notes)?.[1]?.trim()
      if (!title) throw new Error(`Topic document needs a title header: ${directory}`)
      TopicHeaderSchema.parse(title)
      const topic = newTopic(title)
      topic.id = entry.name
      topic.createdAt = (await stat(join(directory, markdown === undefined ? "scratchpad.state.json" : "scratchpad.md"))).birthtime.toISOString()
      topic.learning.notes = notes
      const legacy = await readOptionalFile(join(directory, "topic.json"))
      if (legacy !== undefined) {
        const stored = LegacyTopicStateSchema.parse(JSON.parse(legacy))
        Object.assign(topic, stored, { learning: topic.learning })
      } else {
        topic.materials = await readMaterialManifests(directory)
      }
      const state = storedState ?? { ...freshTopicState(topic.title, topic.createdAt), document: undefined }
      if (state.type !== "generic" && !state.document && markdown !== undefined) {
        const backup = join(directory, "scratchpad.legacy.md")
        if (await readOptionalFile(backup) === undefined) await writeAtomic(backup, markdown)
      }
      topic.state = ScratchpadStateSchema.parse(importStructuredContent(state, notes))
      topic.createdAt = topic.state.createdAt
      if (topic.state.type !== "generic") {
        topic.title = topic.state.name
        topic.learning.notes = scratchpadMarkdown(topic.state, topic.materials)
      }
      if (structured === undefined || JSON.stringify(JSON.parse(structured)) !== JSON.stringify(topic.state))
        await writeAtomic(join(directory, "scratchpad.state.json"), JSON.stringify(topic.state, null, 2))
      if (topic.state.type !== "generic" && markdown !== topic.learning.notes)
        await writeAtomic(join(directory, "scratchpad.md"), topic.learning.notes)
      const saved = savedTopics.find((item) => item.id === topic.id)
      if (saved && legacy === undefined) {
        topic.planConfirmed = saved.planConfirmed
        topic.titleGenerated = saved.titleGenerated
      }
      topic.learning.outline = []
      if (topic.state.type === "topic") topic.learning.outline = topic.state.content.slice(0, 100).map((part) => part.name)
      topic.archived = archivedIds.has(topic.id) || topic.archived
      const parsed = TopicSchema.parse(topic)
      if (legacy !== undefined) {
        // Migrate once into the Tutor Me layout, removing topic.json only after its replacements are written.
        for (const material of parsed.materials) await writeMaterialManifest(directory, material)
        await rm(join(directory, "topic.json"))
      }
      topics.push(parsed)
    }
    return topics.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
  }

  private async readChats() {
    const root = join(this.directory, "chats")
    await mkdir(root, { recursive: true })
    const chats: z.infer<typeof ChatSchema>[] = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !IdSchema.safeParse(entry.name).success) continue
      const raw = await readOptionalFile(join(root, entry.name, "chat.json"))
      if (raw === undefined) continue
      const chat = ChatSchema.parse(JSON.parse(raw))
      if (chat.id !== entry.name) throw new Error(`Chat ID does not match its folder: ${entry.name}`)
      chats.push(chat)
    }
    return chats.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
  }

  async refreshTopics() {
    const operation = this.writes.then(async () => {
      await this.recoverFiles()
      this.state = { ...this.state, topics: await this.readTopics() }
    })
    this.writes = operation.catch(() => {})
    return operation
  }

  get stateSnapshot() {
    return structuredClone(this.state)
  }

  get publicRunners() {
    return structuredClone(this.state.runners)
  }

  get publicTopics() {
    return this.state.topics.map((topic) => {
      const {
        privateAnswerKey: _key,
        workpad: _workpad,
        ...learning
      } = topic.learning
      return PublicTopicSchema.parse({
        ...topic,
        learning,
        materials: topic.materials.map(({ id, name, kind }) => ({
          id,
          name,
          kind,
        })),
      })
    })
  }

  get publicChats() {
    return this.state.chats.map((chat) =>
      PublicChatSchema.parse({
        ...chat,
        phase: chat.learning.phase,
        materials: chat.materials.map(({ id, name, kind }) => ({ id, name, kind })),
      }),
    )
  }

  chat(id: string) {
    const chat = this.state.chats.find((entry) => entry.id === id)
    if (!chat) throw new Error("This chat no longer exists.")
    return structuredClone(chat)
  }

  topic(id: string) {
    const topic = this.state.topics.find((entry) => entry.id === id)
    if (!topic) throw new Error("This topic no longer exists.")
    return structuredClone(topic)
  }

  async mutate(update: (state: Workspace) => void) {
    const operation = this.writes.then(async () => {
      await this.recoverFiles()
      this.state = { ...this.state, topics: await this.readTopics() }
      const next = structuredClone(this.state)
      update(next)
      await this.commit(next)
    })
    this.writes = operation.catch(() => {})
    return operation
  }

  workflow(turnId: string) {
    return this.database.workflow(turnId)
  }

  conversationSummary(chatId: string) {
    return this.database.conversationSummary(chatId)
  }

  async saveWorkflowSummary(turnId: string, summary: z.infer<typeof ConversationSummarySchema>) {
    const operation = this.writes.then(() => {
      const turn = this.database.workflow(turnId)
      turn.summary = summary
      this.database.saveWorkflow(turn, summary)
      return turn.summary
    })
    this.writes = operation.then(() => {}, () => {})
    return operation
  }

  async saveWorkflow(turn: z.infer<typeof WorkflowRecordSchema>) {
    const operation = this.writes.then(() => this.database.saveWorkflow(turn))
    this.writes = operation.catch(() => {})
    return operation
  }

  async updateWorkflow(turnId: string, update: (turn: z.infer<typeof WorkflowRecordSchema>) => void) {
    const operation = this.writes.then(() => {
      const turn = this.database.workflow(turnId)
      update(turn)
      this.database.saveWorkflow(turn)
      return this.database.workflow(turnId)
    })
    this.writes = operation.then(() => {}, () => {})
    return operation
  }

  async mutateWorkflow(turnId: string, update: (turn: z.infer<typeof WorkflowRecordSchema>, state: Workspace) => void) {
    const operation = this.writes.then(async () => {
      await this.recoverFiles()
      this.state = { ...this.state, topics: await this.readTopics() }
      const next = structuredClone(this.state)
      const turn = this.database.workflow(turnId)
      update(turn, next)
      await this.commit(next, turn)
      return this.database.workflow(turnId)
    })
    this.writes = operation.then(() => {}, () => {})
    return operation
  }

  private async commit(state: Workspace, workflow?: z.infer<typeof WorkflowRecordSchema>) {
    const validated = WorkspaceSchema.parse(state)
    for (const topic of validated.topics) {
      const previous = this.state.topics.find((item) => item.id === topic.id)
      if (JSON.stringify(topic) === JSON.stringify(previous)) continue
      topic.state ??= { ...freshTopicState(topic.title, topic.createdAt), document: undefined }
      if (topic.state.type === "generic") {
        const header = TopicHeaderSchema.safeParse(/^\s*# ([^\r\n]+)/.exec(topic.learning.notes)?.[1])
        if (header.success) topic.title = header.data
        topic.title = topic.title.replace(/\s+/g, " ").trim()
        topic.learning.notes = topicNotes(topic.title, topic.learning.notes)
        topic.state.name = topic.title
      } else {
        topic.state = ScratchpadStateSchema.parse(importStructuredContent(topic.state, topic.learning.notes))
        if (topic.state.type === "generic") throw new Error("Unexpected scratchpad type during content migration.")
        topic.title = topic.state.name
        topic.learning.notes = scratchpadMarkdown(topic.state, topic.materials)
      }
      if (topic.state.type === "topic") topic.learning.outline = topic.state.content.slice(0, 100).map((part) => part.name)
      else topic.learning.outline = []
      topic.materials.sort((left, right) => left.name.localeCompare(right.name))
    }
    WorkspaceSchema.parse(validated)
    const previous = this.state
    await this.prepareReferencedAssets(validated, previous)
    this.database.save(validated, workflow)
    this.state = validated
    await this.syncFiles(validated, previous)
    this.database.filesSynced()
  }

  private async prepareReferencedAssets(state: Workspace, previous: Workspace) {
    const sources = [
      ...state.topics.map((topic) => ({ materials: topic.materials, directory: join(this.directory, "scratchpads", topic.id, "assets") })),
      ...state.chats.map((chat) => ({ materials: chat.materials, directory: join(this.directory, "chats", chat.id, "assets") })),
    ]
    for (const topic of state.topics) {
      const before = previous.topics.find((item) => item.id === topic.id)
      const references = scratchpadReferences(topic.state ?? freshTopicState(topic.title, topic.createdAt))
      for (const material of topic.materials) {
        if (before?.materials.some((item) => item.id === material.id)) continue
        const directory = join(this.directory, "scratchpads", topic.id, "assets")
        // Legacy metadata may have no original file; transfers from another owner must still copy uncited attachments.
        if (!references.some((reference) => reference.type !== "website" && reference.type !== "topic" && reference.path === `assets/${material.name}`)
          && !sources.some((source) => source.directory !== directory && source.materials.some((item) => item.id === material.id))) continue
        const destination = join(directory, material.name)
        try {
          if (!(await stat(destination)).isFile()) throw new Error(`Source asset is not a file: ${material.name}`)
          continue
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
        }
        await mkdir(directory, { recursive: true })
        let copied = false
        for (const source of sources) {
          if (source.directory === directory || !source.materials.some((item) => item.id === material.id)) continue
          try {
            // Prepare independent topic assets before committing; recovery can then mirror state without the original owner.
            await copyFile(join(source.directory, material.name), destination, constants.COPYFILE_EXCL)
            copied = true
            break
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
          }
        }
        if (!copied) throw new Error(`Referenced source is unavailable: ${material.name}. Attach it again before creating the topic.`)
      }
    }
  }

  private async recoverFiles() {
    const saved = this.database.load()
    if (!saved?.filesPending) return
    await this.syncFiles(saved.state, WorkspaceSchema.parse({ version: 2, runners: [], topics: [], chats: [] }))
    await this.removeRecoveredFiles(saved.removedFiles)
    this.database.filesSynced()
    this.state = saved.state
  }

  private async removeRecoveredFiles(removed: { topics: string[]; chats: string[] }) {
    for (const collection of ["topics", "chats"] as const) {
      for (const id of removed[collection])
        await rm(join(this.directory, collection === "topics" ? "scratchpads" : collection, id), { recursive: true, force: true })
    }
  }

  private async syncFiles(validated: Workspace, previousState: Workspace) {
    for (const topic of validated.topics) {
      const previous = previousState.topics.find((item) => item.id === topic.id)
      const directory = join(this.directory, "scratchpads", topic.id)
      await mkdir(directory, { recursive: true })
      await mkdir(join(directory, "assets"), { recursive: true })
      const state = ScratchpadStateSchema.parse(importStructuredContent(topic.state ?? { ...freshTopicState(topic.title, topic.createdAt), document: undefined }, topic.learning.notes))
      topic.state = state
      if (state.type !== "generic") topic.learning.notes = scratchpadMarkdown(state, topic.materials)
      if (!previous || JSON.stringify(state) !== JSON.stringify(previous.state))
        await writeAtomic(join(directory, "scratchpad.state.json"), JSON.stringify(state, null, 2))
      if (topic.learning.notes !== previous?.learning.notes)
        await writeAtomic(join(directory, "scratchpad.md"), topic.learning.notes)
      for (const material of topic.materials) {
        if (!previous?.materials.some((item) => item.id === material.id))
          await writeMaterialManifest(directory, material)
      }
    }
    for (const topic of previousState.topics) {
      if (!validated.topics.some((item) => item.id === topic.id))
        await rm(join(this.directory, "scratchpads", topic.id), { recursive: true, force: true })
    }
    for (const chat of previousState.chats) {
      if (!validated.chats.some((item) => item.id === chat.id))
        await rm(join(this.directory, "chats", chat.id), { recursive: true, force: true })
    }
  }

  async exportStudyFiles(topic: Topic, directory: string) {
    await mkdir(directory, { recursive: true })
    const assets = join(this.directory, "scratchpads", topic.id, "assets")
    if (topic.materials.length) {
      await mkdir(join(directory, "assets"), { recursive: true })
      for (const file of await readdir(assets, { withFileTypes: true })) {
        if (file.isFile()) await copyFile(join(assets, file.name), join(directory, "assets", file.name))
      }
    }
    const portable = (text: string) =>
      text.replace(
        /prune-source:\/\/([a-f0-9-]+)\/(\d+)/g,
        "assets/source-$1-$2.png",
      )
    // The private handoff stays in app storage; learner exports never include checked answer keys.
    await writeFile(
      join(directory, "scratchpad.md"),
      portable(topicDirectoryMarkdown(topicNotes(topic.title, topic.learning.notes))),
      { mode: 0o600 },
    )
  }
}

export function newTopic(title: string, type: z.infer<typeof ScratchpadTypeSchema> = "topic") {
  const createdAt = new Date().toISOString()
  let state: z.infer<typeof ScratchpadStateSchema> = freshTopicState(title, createdAt)
  if (type === "test") state = ScratchpadStateSchema.parse({ type, version: "19-10-2026", createdAt, name: title, document: { version: 1, blocks: [] }, goals: [], questions: [], references: [], content: [] })
  if (type === "generic") state = ScratchpadStateSchema.parse({ type, version: "19-10-2026", createdAt, name: title, references: [] })
  const scratchpad = TopicSchema.parse({
    id: randomUUID(),
    title,
    createdAt,
    state,
    planConfirmed: type !== "topic",
    materials: [],
    learning: LearningStateSchema.parse({
      phase: "awaiting_plan_confirmation",
      outline: [],
      currentSection: "",
      pendingQuestion: "",
      privateAnswerKey: "",
      nextAction: "Research existing walkthroughs, propose a source-linked learning plan, and wait for confirmation.",
      notes: `# ${title}\n\n`,
      workpad: "New topic; plan is not confirmed.",
    }),
  })
  if (type !== "topic") {
    scratchpad.learning.phase = "ready_to_continue"
    scratchpad.learning.nextAction = "Respond to the learner's request."
    scratchpad.learning.workpad = `New ${type} scratchpad.`
  }
  if (state.type !== "generic") scratchpad.learning.notes = scratchpadMarkdown(state, scratchpad.materials)
  return scratchpad
}

export function newChat(runnerId: string, title = "New chat") {
  return ChatSchema.parse({
    id: randomUUID(),
    title,
    runnerId,
    createdAt: new Date().toISOString(),
    messages: [],
    materials: [],
    learning: {
      phase: "ready_to_continue",
      outline: [],
      currentSection: "",
      pendingQuestion: "",
      privateAnswerKey: "",
      nextAction: "Respond to the learner's request.",
      notes: "",
      workpad: "New chat.",
    },
  })
}
