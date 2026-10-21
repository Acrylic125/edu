import { WorkspaceRepository } from "../src/main/workspace"
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test } from "vitest"
import { z } from "zod"
import {
  WorkerJobSchema,
  TraceEventSchema,
} from "../src/shared/contracts"
import { runCodexTutorTurn } from "../src/runners/codex"

const environment = z
  .object({ PRUNE_LIVE_DATA_DIR: z.string().optional() })
  .parse(process.env)

test.skipIf(!environment.PRUNE_LIVE_DATA_DIR)(
  "connected Codex saves the latest learner request in an isolated chat copy",
  async () => {
    if (!environment.PRUNE_LIVE_DATA_DIR)
      throw new Error("Missing live workspace")
    const workspaceDirectory = join(
      environment.PRUNE_LIVE_DATA_DIR,
      "workspace",
    )
    const repository = new WorkspaceRepository(workspaceDirectory)
    const workspace = await repository.load()
    const chat = workspace.chats.find((chat) =>
      workspace.runners.some(
        (runner) => runner.id === chat.runnerId && runner.provider === "codex",
      ),
    )
    if (!chat) throw new Error("No Codex chat is available to validate")
    const runner = workspace.runners.find(
      (runner) => runner.id === chat.runnerId,
    )
    const directory = await mkdtemp(join(tmpdir(), "prune-live-validation-"))
    const copy = async (collection: string, owner: { id: string; materials: { name: string }[] }) => {
      const assets = join(directory, collection, owner.id, "assets")
      await mkdir(assets, { recursive: true })
      for (const material of owner.materials)
        await cp(
          join(workspaceDirectory, collection, owner.id, "assets", material.name),
          join(assets, material.name),
        )
      return assets
    }
    const tagged = chat.messages.flatMap((message) => message.topicIds)
    const topics = []
    for (const topic of workspace.topics.filter((topic) => tagged.includes(topic.id)))
      topics.push({ ...topic, assetDirectory: await copy("scratchpads", topic) })
    const job = WorkerJobSchema.parse({
      chat,
      topics,
      runner,
      assetDirectory: await copy("chats", chat),
      skillDirectory: resolve("resources/tutor-me"),
      codex: {
        executable: resolve(
          "release/mac-arm64/EdU.app/Contents/Resources/resources/codex/bin/codex",
        ),
        home: join(workspaceDirectory, "providers", "codex"),
      },
    })
    const events: z.infer<typeof TraceEventSchema>[] = []
    console.info(`Live validation trace: ${join(directory, "trace.json")}`)
    try {
      const result = await runCodexTutorTurn(
        job,
        (message) => console.info(message),
        () => {},
        (event, details) => {
          events.push({ time: new Date().toISOString(), event, details })
          if (event === "turn.completed" || event === "tool.result")
            console.info(event, details)
        },
      )
      expect(result.learning.workpad.trim()).not.toBe("")
      expect(result.reply.trim()).not.toBe("")
      console.info("Validated live reply and saved handoff", {
        replyCharacters: result.reply.length,
        topicUpdates: result.topicUpdates.length,
      })
    } finally {
      await writeFile(
        join(directory, "trace.json"),
        JSON.stringify(events, null, 2),
        { mode: 0o600 },
      )
    }
  },
  300_000,
)
