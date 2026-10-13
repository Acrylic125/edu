import { randomUUID } from "node:crypto"
import {
  copyFile,
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
  LearningStateSchema,
  ChatSchema,
  LegacyWorkspaceSchema,
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

const SettingsSchema = WorkspaceSchema.pick({ runners: true, providerSettings: true }).extend({
  version: z.literal(3),
})
const TopicStateSchema = TopicSchema.omit({ id: true, title: true, learning: true }).extend({
  learning: z.object(LearningStateSchema.shape).omit({ notes: true, workpad: true }),
})
const TopicHeaderSchema = TopicSchema.shape.title.trim().min(1).regex(/^[^\r\n]+$/)

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
    if (saved) {
      this.state = saved.state
      if (saved.filesPending) {
        await this.syncFiles(this.state, WorkspaceSchema.parse({ version: 2, runners: [], topics: [], chats: [] }))
        await this.removeRecoveredFiles(saved.removedFiles)
        this.database.filesSynced()
      }
      this.state = { ...this.state, topics: await this.readTopics() }
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
          .discriminatedUnion("version", [WorkspaceSchema, LegacyWorkspaceSchema])
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
          model: "default",
        })
      }
      await this.commit(state)
      // Keep the legacy transaction until every migrated topic and chat can be read back.
      this.state = WorkspaceSchema.parse({ ...this.state, topics: await this.readTopics(), chats: this.database.load()?.state.chats ?? [] })
    }
    await this.pruneObsoleteFiles()
    return this.state
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
      const root = join(this.directory, collection)
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
        const match = /^(?:workspace\.json|settings\.json|chat\.json|topic\.json|topic\.md|agent\.workpad\.md)\.(.+)\.tmp$/.exec(entry.name)
        if (match && IdSchema.safeParse(match[1]).success)
          await rm(join(directory, entry.name), { force: true })
      }
    }
  }

  private async readTopics() {
    const root = join(this.directory, "topics")
    await mkdir(root, { recursive: true })
    const topics: Topic[] = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !IdSchema.safeParse(entry.name).success) continue
      const directory = join(root, entry.name)
      const notes = await readOptionalFile(join(directory, "topic.md"))
      if (notes === undefined) continue
      const title = /^\s*# ([^\r\n]+)/.exec(notes)?.[1]?.trim()
      if (!title) throw new Error(`Topic document needs a title header: ${directory}`)
      TopicHeaderSchema.parse(title)
      const raw = await readOptionalFile(join(directory, "topic.json"))
      if (raw === undefined) {
        const topic = newTopic(title)
        topic.id = entry.name
        topic.createdAt = (await stat(join(directory, "topic.md"))).birthtime.toISOString()
        topic.learning.notes = notes
        topic.learning.workpad = await readOptionalFile(join(directory, "agent.workpad.md")) ?? topic.learning.workpad
        topics.push(TopicSchema.parse(topic))
        continue
      }
      const stored = TopicStateSchema.parse(JSON.parse(raw))
      const workpad = await readFile(join(directory, "agent.workpad.md"), "utf8")
      topics.push(TopicSchema.parse({
        ...stored,
        id: entry.name,
        title,
        learning: { ...stored.learning, notes, workpad },
      }))
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

  private async commit(state: Workspace) {
    const validated = WorkspaceSchema.parse(state)
    for (const topic of validated.topics) {
      const previous = this.state.topics.find((item) => item.id === topic.id)
      if (JSON.stringify(topic) === JSON.stringify(previous)) continue
      topic.title = topic.title.replace(/\s+/g, " ").trim()
      topic.learning.notes = topicNotes(topic.title, topic.learning.notes)
    }
    WorkspaceSchema.parse(validated)
    const previous = this.state
    this.database.save(validated)
    this.state = validated
    await this.syncFiles(validated, previous)
    this.database.filesSynced()
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
        await rm(join(this.directory, collection, id), { recursive: true, force: true })
    }
  }

  private async syncFiles(validated: Workspace, previousState: Workspace) {
    for (const topic of validated.topics) {
      const previous = previousState.topics.find((item) => item.id === topic.id)
      const directory = join(this.directory, "topics", topic.id)
      await mkdir(directory, { recursive: true })
      const notes = topic.learning.notes
      if (notes !== previous?.learning.notes)
        await writeAtomic(join(directory, "topic.md"), notes)
      if (topic.learning.workpad !== previous?.learning.workpad)
        await writeAtomic(join(directory, "agent.workpad.md"), topic.learning.workpad)
      const stored = TopicStateSchema.parse({ ...topic, learning: topic.learning })
      if (!previous || JSON.stringify(stored) !== JSON.stringify(TopicStateSchema.parse({ ...previous, learning: previous.learning })))
        await writeAtomic(join(directory, "topic.json"), JSON.stringify(stored, null, 2))
    }
    for (const topic of previousState.topics) {
      if (!validated.topics.some((item) => item.id === topic.id))
        await rm(join(this.directory, "topics", topic.id), { recursive: true, force: true })
    }
    for (const chat of previousState.chats) {
      if (!validated.chats.some((item) => item.id === chat.id))
        await rm(join(this.directory, "chats", chat.id), { recursive: true, force: true })
    }
  }

  async exportStudyFiles(topic: Topic, directory: string) {
    await mkdir(directory, { recursive: true })
    const assets = join(this.directory, "topics", topic.id, "assets")
    if (topic.materials.length) {
      await mkdir(join(directory, "assets"), { recursive: true })
      for (const file of await readdir(assets))
        await copyFile(join(assets, file), join(directory, "assets", file))
    }
    const portable = (text: string) =>
      text.replace(
        /prune-source:\/\/([a-f0-9-]+)\/(\d+)/g,
        "assets/source-$1-$2.png",
      )
    // The private handoff stays in app storage; learner exports never include checked answer keys.
    await writeFile(
      join(directory, "topic.md"),
      portable(topicDirectoryMarkdown(topicNotes(topic.title, topic.learning.notes))),
      { mode: 0o600 },
    )
  }
}

export function newTopic(title: string) {
  return TopicSchema.parse({
    id: randomUUID(),
    title,
    createdAt: new Date().toISOString(),
    planConfirmed: false,
    materials: [],
    learning: LearningStateSchema.parse({
      phase: "awaiting_plan_confirmation",
      outline: [],
      currentSection: "",
      pendingQuestion: "",
      privateAnswerKey: "",
      nextAction: "Propose a learning plan and wait for confirmation.",
      notes: `# ${title}\n\nYour proposed learning plan will appear here.`,
      workpad: "New topic; plan is not confirmed.",
    }),
  })
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
