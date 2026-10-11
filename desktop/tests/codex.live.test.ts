import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test } from "vitest"
import { z } from "zod"
import {
  WorkspaceSchema,
  WorkerJobSchema,
  TraceEventSchema,
} from "../src/shared/contracts"
import { runCodexTutorTurn } from "../src/runners/codex"

const environment = z
  .object({ PRUNE_LIVE_DATA_DIR: z.string().optional() })
  .parse(process.env)

test.skipIf(!environment.PRUNE_LIVE_DATA_DIR)(
  "connected Codex saves the latest learner request in an isolated topic copy",
  async () => {
    if (!environment.PRUNE_LIVE_DATA_DIR)
      throw new Error("Missing live workspace")
    const workspaceDirectory = join(
      environment.PRUNE_LIVE_DATA_DIR,
      "workspace",
    )
    const workspace = WorkspaceSchema.parse(
      JSON.parse(
        await readFile(join(workspaceDirectory, "workspace.json"), "utf8"),
      ),
    )
    const topic = workspace.topics.find((topic) =>
      workspace.runners.some(
        (runner) => runner.id === topic.runnerId && runner.provider === "codex",
      ),
    )
    if (!topic) throw new Error("No Codex topic is available to validate")
    const runner = workspace.runners.find(
      (runner) => runner.id === topic.runnerId,
    )
    const directory = await mkdtemp(join(tmpdir(), "prune-live-validation-"))
    const assetDirectory = join(directory, "topic", "assets")
    await mkdir(assetDirectory, { recursive: true })
    for (const material of topic.materials) {
      await cp(
        join(workspaceDirectory, "topics", topic.id, "assets", material.name),
        join(assetDirectory, material.name),
      )
    }
    const job = WorkerJobSchema.parse({
      topic,
      runner,
      assetDirectory,
      action: "message",
      skillDirectory: resolve("resources/tutor-me"),
      codex: {
        executable: resolve(
          "release/mac-arm64/Prune.app/Contents/Resources/resources/codex/bin/codex",
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
      expect(result.learning.notes.trim()).not.toBe("")
      expect(result.learning.workpad.trim()).not.toBe("")
      expect(result.reply.trim()).not.toBe("")
      console.info("Validated live reply and saved notes", {
        replyCharacters: result.reply.length,
        outlineSections: result.learning.outline.length,
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
