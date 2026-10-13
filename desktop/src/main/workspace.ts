import { randomUUID } from "node:crypto"
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
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
  type Topic,
  type Workspace,
} from "../shared/contracts"
import { topicDirectoryMarkdown } from "../shared/topic-directory"
import { z } from "zod"

export class WorkspaceRepository {
  private state: Workspace = WorkspaceSchema.parse({ version: 2, runners: [], topics: [], chats: [] })
  private writes = Promise.resolve()

  constructor(readonly directory: string) {}

  async load() {
    await mkdir(this.directory, { recursive: true })
    try {
      const raw = await readFile(join(this.directory, "workspace.json"), "utf8")
      const stored = z
        .discriminatedUnion("version", [WorkspaceSchema, LegacyWorkspaceSchema])
        .parse(JSON.parse(raw))
      if (stored.version === 2) {
        this.state = stored
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
        // Keep the original file so a failed migration can be recovered by hand.
        await writeFile(join(this.directory, "workspace.v1.json"), raw, {
          mode: 0o600,
          flag: "wx",
        }).catch((error) => {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
            throw error
        })
        await this.commit(
          WorkspaceSchema.parse({ ...stored, version: 2, chats }),
        )
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error
      this.state.runners.push({
        id: randomUUID(),
        name: "Tutor",
        provider: "codex",
        model: "default",
      })
      await this.commit(this.state)
    }
    return this.state
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
      const next = structuredClone(this.state)
      update(next)
      await this.commit(next)
    })
    this.writes = operation.catch(() => {})
    return operation
  }

  private async commit(state: Workspace) {
    const validated = WorkspaceSchema.parse(state)
    const destination = join(this.directory, "workspace.json")
    const temporary = `${destination}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(validated, null, 2), {
      mode: 0o600,
    })
    WorkspaceSchema.parse(JSON.parse(await readFile(temporary, "utf8")))
    await rename(temporary, destination)
    this.state = validated
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
      portable(topicDirectoryMarkdown(topic.learning.notes)),
      { mode: 0o600 },
    )
  }

  async mirrorHandoff(topic: Topic) {
    const directory = join(this.directory, "topics", topic.id)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "topic.md"), topic.learning.notes, {
      mode: 0o600,
    })
    await writeFile(
      join(directory, "agent.workpad.md"),
      `${topic.learning.workpad}\n\n## Structured handoff\n\n${JSON.stringify(topic.learning, null, 2)}`,
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
