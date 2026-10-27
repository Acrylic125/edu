import { spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import { createInterface } from "node:readline"
import { z } from "zod"
import type { CodexConnectionSchema, Diagnostic } from "../shared/contracts"

const JsonSchema = z.json()
const MessageSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: JsonSchema.optional(),
  result: JsonSchema.optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
})

export class CodexAppServer {
  readonly notifications = new EventEmitter()
  readonly child
  private sequence = 0
  private stopped = false
  private pending = new Map<
    number,
    {
      resolve: (value: z.infer<typeof JsonSchema>) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  onRequest?: (
    method: string,
    params: z.infer<typeof JsonSchema>,
  ) => Promise<z.infer<typeof JsonSchema>>

  constructor(
    connection: z.infer<typeof CodexConnectionSchema>,
    cwd = connection.home,
    private diagnostic: Diagnostic = () => {},
  ) {
    const {
      OPENAI_API_KEY: _openaiKey,
      CODEX_API_KEY: _codexKey,
      OPENAI_BASE_URL: _openaiBaseUrl,
      CODEX_HOME: _codexHome,
      ...environment
    } = process.env
    // An isolated Codex home keeps EdU's account and configuration separate from other clients.
    this.child = spawn(
      connection.executable,
      [
        "app-server",
        "--listen",
        "stdio://",
        "-c",
        // Each spawned runtime must avoid interactive OS credential prompts.
        'cli_auth_credentials_store="file"',
        "-c",
        'mcp_oauth_credentials_store="file"',
        "-c",
        'web_search="live"',
        "-c",
        "tools.view_image=false",
        ...[
          "shell_tool",
          "unified_exec",
          "view_image",
          "multi_agent",
          "multi_agent_v2",
          "apps",
          "plugins",
          "hooks",
          "computer_use",
          "browser_use",
        ].flatMap((feature) => ["--disable", feature]),
        "--enable",
        "skip_host_skill_discovery",
        "--enable",
        "code_mode_host",
      ],
      {
        cwd,
        env: { ...environment, CODEX_HOME: connection.home },
        stdio: "pipe",
        windowsHide: true,
      },
    )
    this.child.stderr.resume()
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        if (line.length > 16_000_000)
          throw new Error("Codex returned an oversized message.")
        const message = MessageSchema.parse(JSON.parse(line))
        const metadata = z
          .object({
            threadId: z.string().optional(),
            turnId: z.string().optional(),
            tool: z.string().optional(),
            item: z
              .object({
                type: z.string(),
                phase: z.string().nullish(),
                text: z.string().optional(),
              })
              .optional(),
          })
          .safeParse(message.params)
        if (!message.method?.endsWith("/delta"))
          this.diagnostic("codex.receive", {
            method: message.method ?? "response",
            id: message.id ?? null,
            error: message.error?.message ?? null,
            threadId: metadata.data?.threadId ?? null,
            turnId: metadata.data?.turnId ?? null,
            tool: metadata.data?.tool ?? null,
            itemType: metadata.data?.item?.type ?? null,
            phase: metadata.data?.item?.phase ?? null,
            textCharacters: metadata.data?.item?.text?.length ?? 0,
          })
        if (message.method) {
          if (message.id !== undefined) {
            const id = message.id
            const operation =
              this.onRequest?.(message.method, message.params ?? null) ??
              Promise.reject(
                new Error(
                  "This tool is not available in the tutoring harness.",
                ),
              )
            void operation.then(
              (result) => this.write({ id, result }),
              () =>
                this.write({
                  id,
                  error: {
                    code: -32601,
                    message:
                      "This tool is not available in the tutoring harness.",
                  },
                }),
            )
          } else this.notifications.emit(message.method, message.params ?? null)
          return
        }
        if (typeof message.id !== "number") return
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(message.error.message))
        else if (message.result !== undefined) pending.resolve(message.result)
        else pending.reject(new Error("Codex returned an invalid response."))
      } catch {
        this.diagnostic("codex.protocol_error", {
          message: "Invalid or oversized JSON-RPC message",
        })
        this.close(new Error("Codex returned an invalid protocol message."))
      }
    })
    this.child.once("error", () =>
      this.close(new Error("Codex could not start. Check its installation in Settings → Providers.")),
    )
    this.child.once("exit", (code, signal) => {
      this.diagnostic("codex.exit", { code, signal })
      this.close(new Error("Codex stopped. Refresh the provider and retry."))
    })
    this.child.stdin.on("error", () =>
      this.close(new Error("The Codex connection closed.")),
    )
  }

  private write(message: z.infer<typeof JsonSchema>) {
    const metadata = z
      .object({
        method: z.string().optional(),
        id: z.union([z.number(), z.string()]).optional(),
      })
      .safeParse(message)
    this.diagnostic("codex.send", {
      method: metadata.data?.method ?? "response",
      id: metadata.data?.id ?? null,
    })
    if (!this.stopped && !this.child.stdin.destroyed)
      this.child.stdin.write(JSON.stringify(message) + "\n")
  }

  async request<Schema extends z.ZodType>(
    method: string,
    params: z.infer<typeof JsonSchema>,
    schema: Schema,
  ) {
    if (this.stopped) throw new Error("The Codex connection closed.")
    const id = ++this.sequence
    const response = new Promise<z.infer<typeof JsonSchema>>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id)
          reject(
            new Error(
              `Codex ${method} timed out. Refresh the provider and retry.`,
            ),
          )
        }, 20_000)
        this.pending.set(id, { resolve, reject, timer })
        this.write({ id, method, params })
      },
    )
    return schema.parse(await response)
  }

  async initialize() {
    await this.request(
      "initialize",
      {
        clientInfo: { name: "prune_desktop", title: "EdU", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      },
      z.object({}).passthrough(),
    )
    this.write({ method: "initialized" })
  }

  waitFor<Schema extends z.ZodType>(
    method: string,
    schema: Schema,
    timeoutMs = 300_000,
  ) {
    let dispose = () => {}
    const promise = new Promise<z.output<Schema>>((resolve, reject) => {
      const receive = (raw: z.infer<typeof JsonSchema>) => {
        const result = schema.safeParse(raw)
        if (!result.success) return
        dispose()
        resolve(result.data)
      }
      const closed = (error: Error) => {
        dispose()
        reject(error)
      }
      const timer = setTimeout(() => {
        dispose()
        reject(new Error("Codex timed out. Retry this turn."))
      }, timeoutMs)
      dispose = () => {
        clearTimeout(timer)
        this.notifications.off(method, receive)
        this.notifications.off("closed", closed)
      }
      this.notifications.on(method, receive)
      this.notifications.on("closed", closed)
    })
    return { promise, dispose }
  }

  close(error = new Error("The Codex connection closed.")) {
    if (this.stopped) return
    this.stopped = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.notifications.emit("closed", error)
    this.child.stdin.end()
    if (this.child.exitCode === null) {
      this.child.kill()
      const timer = setTimeout(() => {
        if (this.child.exitCode === null) this.child.kill("SIGKILL")
      }, 1000)
      timer.unref()
    }
  }
}
