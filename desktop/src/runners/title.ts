import { mkdir } from "node:fs/promises"
import OpenAI from "openai"
import { z } from "zod"
import { CodexAppServer } from "../providers/codex-rpc"
import { readCodexModels } from "../providers/codex"
import { cliPromptArguments, parseCliResponse, prepareCliWorkspace, runCliCommand } from "../providers/cli"
import type { WorkerJob, Diagnostic } from "../shared/contracts"
import { stripTopicMentions } from "../shared/topic-mentions"

const TitleSchema = z.object({
  title: z.string().trim().min(1).max(150).regex(/^[^\r\n]+$/),
})
const instructions =
  "Generate a concise title of 3–8 words from the learner's request. Use the learner's language. Do not include markdown or explanation."

export async function generateTopicTitle(
  job: Pick<WorkerJob, "runner" | "codex" | "cli" | "titleModel">,
  request: string,
  client: OpenAI | undefined,
  processChanged: (pid: number | null) => void,
  diagnostic: Diagnostic,
) {
  const input = stripTopicMentions(request).slice(0, 1800)
  if (!input.trim()) throw new Error("A suggested topic is needed to generate a title.")
  if (job.cli) {
    await prepareCliWorkspace(job.cli)
    let model = "default"
    if (job.cli.provider === "claude") model = "haiku"
    diagnostic("title.model", { provider: job.cli.provider, model })
    const output = await runCliCommand(
      job.cli,
      cliPromptArguments(job.cli, JSON.stringify(z.toJSONSchema(TitleSchema)), model),
      `${instructions}\n\nSuggested topic:\n${input}`,
      processChanged,
      30_000,
    )
    return TitleSchema.parse(parseCliResponse(job.cli.provider, output)).title
  }
  if (job.runner.provider === "openrouter") {
    if (!client || !job.titleModel)
      throw new Error("No priced title model is available from OpenRouter.")
    diagnostic("title.model", {
      provider: "openrouter",
      model: job.titleModel.id,
    })
    const result = await client.chat.completions.create(
      {
        model: job.titleModel.id,
        messages: [
          { role: "system", content: instructions + " Return only the title, without quotes." },
          { role: "user", content: input },
        ],
        max_tokens: 80,
      },
      { timeout: 30_000, maxRetries: 0 },
    )
    const title = result.choices[0]?.message.content
      ?.trim()
      .replace(/^["'“]|["'”]$/g, "")
    return TitleSchema.parse({ title }).title
  }
  if (!job.codex) throw new Error("The Codex runtime is unavailable.")
  await mkdir(job.codex.home, { recursive: true, mode: 0o700 })
  const server = new CodexAppServer(job.codex, undefined, diagnostic)
  processChanged(server.child.pid ?? null)
  try {
    await server.initialize()
    const models = await readCodexModels(server)
    // Codex has no prices in model/list; prefer known budget models without upgrading to the tutor's model.
    const budgetModels = [
      "gpt-6-luna",
      "gpt-5.6-luna",
      "gpt-5.4-mini",
      "gpt-5.1-codex-mini",
    ]
    const model = budgetModels
      .map((id) => models.find((model) => model.id === id))
      .find((model) => model)
    if (!model) throw new Error("No budget title model is available from Codex.")
    diagnostic("title.model", { provider: "codex", model: model.id })
    const { thread } = await server.request(
      "thread/start",
      {
        model: model.id,
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        baseInstructions: instructions,
        dynamicTools: [],
      },
      z.object({ thread: z.object({ id: z.string() }) }),
    )
    let reply = ""
    server.notifications.on(
      "item/completed",
      (raw: z.infer<ReturnType<typeof z.json>>) => {
        const event = z.object({
          threadId: z.string(),
          item: z.object({
            type: z.string(),
            text: z.string().optional(),
            phase: z.string().nullish(),
          }),
        }).safeParse(raw)
        if (
          event.success &&
          event.data.threadId === thread.id &&
          event.data.item.type === "agentMessage" &&
          event.data.item.phase !== "commentary"
        )
          reply = event.data.item.text ?? reply
      },
    )
    const completion = server.waitFor(
      "turn/completed",
      z.object({
        threadId: z.literal(thread.id),
        turn: z.object({ status: z.enum(["completed", "failed", "interrupted"]) }),
      }),
      30_000,
    )
    void completion.promise.catch(() => {})
    try {
      const effort = ["none", "minimal", "low"]
        .map((effort) => model.reasoningEfforts.find((supported) => supported === effort))
        .find((effort) => effort)
      await server.request(
        "turn/start",
        {
          threadId: thread.id,
          input: [{ type: "text", text: input }],
          effort: effort ?? model.defaultReasoningEffort ?? null,
          outputSchema: z.json().parse(z.toJSONSchema(TitleSchema)),
        },
        z.object({}).passthrough(),
      )
      const event = await completion.promise
      if (event.turn.status !== "completed") throw new Error("Codex title generation failed.")
      return TitleSchema.parse(JSON.parse(reply)).title
    } finally {
      completion.dispose()
    }
  } finally {
    server.close()
    processChanged(null)
  }
}
