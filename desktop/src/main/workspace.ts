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
  PublicTopicSchema,
  TopicSchema,
  WorkspaceSchema,
  type Topic,
  type Workspace,
} from "../shared/contracts"

export class WorkspaceRepository {
  private state: Workspace = WorkspaceSchema.parse({ version: 1, runners: [], topics: [] })
  private writes = Promise.resolve()

  constructor(readonly directory: string) {}

  async load() {
    await mkdir(this.directory, { recursive: true })
    try {
      this.state = WorkspaceSchema.parse(
        JSON.parse(
          await readFile(join(this.directory, "workspace.json"), "utf8"),
        ),
      )
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
    await writeFile(
      join(directory, "topic.md"),
      portable(topic.learning.notes),
      { mode: 0o600 },
    )
    // The private handoff stays in app storage; learner exports never include checked answer keys.
    await writeFile(
      join(directory, "conversation.md"),
      portable(
        topic.messages
          .map((message) => `## ${message.role}\n\n${message.content}`)
          .join("\n\n"),
      ),
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

export function newTopic(title: string, runnerId: string) {
  return TopicSchema.parse({
    id: randomUUID(),
    title,
    runnerId,
    createdAt: new Date().toISOString(),
    planConfirmed: false,
    messages: [],
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
