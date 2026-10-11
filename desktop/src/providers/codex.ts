import { mkdir } from "node:fs/promises"
import { z } from "zod"
import {
  ProviderStatusSchema,
  ReasoningEffortSchema,
  type CodexConnectionSchema,
} from "../shared/contracts"
import { CodexAppServer } from "./codex-rpc"

export const CodexModelsSchema = z.object({
  data: z.array(
    z.object({
      model: z.string(),
      displayName: z.string(),
      description: z.string().default(""),
      hidden: z.boolean().default(false),
      isDefault: z.boolean().default(false),
      supportedReasoningEfforts: z
        .array(z.object({ reasoningEffort: ReasoningEffortSchema }))
        .default([]),
      defaultReasoningEffort: ReasoningEffortSchema.optional(),
    }),
  ),
  nextCursor: z.string().nullish(),
})
const AccountSchema = z.object({
  account: z
    .object({
      type: z.string(),
      email: z.string().optional(),
      planType: z.string().nullish(),
    })
    .nullable(),
})
const LoginCompletedSchema = z.object({
  loginId: z.string(),
  success: z.boolean(),
  error: z.string().nullish(),
})

export async function readCodexModels(client: CodexAppServer) {
  const models: z.infer<typeof ProviderStatusSchema>["models"] = []
  let cursor: string | undefined
  const seen = new Set<string>()
  do {
    const result = await client.request(
      "model/list",
      { includeHidden: false, ...(cursor ? { cursor } : {}) },
      CodexModelsSchema,
    )
    models.push(
      ...result.data
        .filter((model) => !model.hidden)
        .map((model) => ({
          id: model.model,
          name: model.displayName,
          description: model.description,
          isDefault: model.isDefault,
          reasoningEfforts: model.supportedReasoningEfforts.map(
            (effort) => effort.reasoningEffort,
          ),
          defaultReasoningEffort: model.defaultReasoningEffort,
        })),
    )
    cursor = result.nextCursor ?? undefined
    if (cursor && seen.has(cursor))
      throw new Error("Codex returned an invalid model catalog cursor.")
    if (cursor) seen.add(cursor)
  } while (cursor)
  return models
}

export class CodexProvider {
  state = ProviderStatusSchema.parse({
    id: "codex",
    name: "Codex",
    connected: false,
    loading: true,
    models: [],
  })
  private client?: CodexAppServer
  private loginId?: string
  private loginAttempt = 0
  private loginTimer?: ReturnType<typeof setTimeout>
  private starting?: Promise<CodexAppServer>
  private startingClient?: CodexAppServer
  private stopped = false

  constructor(
    readonly connection: z.infer<typeof CodexConnectionSchema>,
    private notify: () => void,
    private openBrowser: (url: string) => Promise<void>,
  ) {}

  private async server() {
    if (this.stopped) throw new Error("Codex provider is closed.")
    if (this.starting) return this.starting
    if (this.client) return this.client
    this.starting = (async () => {
      await mkdir(this.connection.home, { recursive: true, mode: 0o700 })
      if (this.stopped) throw new Error("Codex provider is closed.")
      const client = new CodexAppServer(this.connection)
      this.startingClient = client
      try {
        await client.initialize()
        if (this.stopped) throw new Error("Codex provider is closed.")
      } catch (error) {
        client.close()
        throw error
      }
      this.client = client
      client.notifications.on("closed", () => {
        if (this.client !== client) return
        this.client = undefined
        this.state.connected = false
        this.state.connecting = false
        this.state.error = "Codex stopped. Refresh the provider to reconnect."
        clearTimeout(this.loginTimer)
        this.loginId = undefined
        this.notify()
      })
      client.notifications.on(
        "account/login/completed",
        (raw: z.infer<ReturnType<typeof z.json>>) => {
          const event = LoginCompletedSchema.safeParse(raw)
          if (!event.success || event.data.loginId !== this.loginId) return
          this.loginId = undefined
          clearTimeout(this.loginTimer)
          this.state.connecting = false
          if (event.data.success) void this.refresh()
          else {
            this.state.error =
              event.data.error ?? "Codex sign-in was not completed. Try again."
            this.notify()
          }
        },
      )
      return client
    })()
    try {
      return await this.starting
    } finally {
      this.starting = undefined
      this.startingClient = undefined
    }
  }

  async refresh() {
    this.state.loading = true
    this.state.error = undefined
    this.notify()
    try {
      const client = await this.server()
      const { account } = await client.request(
        "account/read",
        { refreshToken: false },
        AccountSchema,
      )
      this.state.connected = account !== null
      this.state.account = account?.email
      if (!this.state.account && account) this.state.account = "OpenAI account"
      this.state.models = await readCodexModels(client)
    } catch (error) {
      this.state.error =
        error instanceof Error ? error.message : "Could not refresh Codex."
    } finally {
      this.state.loading = false
      this.notify()
    }
  }

  async connect() {
    if (this.state.connecting) throw new Error("Codex sign-in is already open.")
    const attempt = ++this.loginAttempt
    this.state.connecting = true
    this.state.error = undefined
    this.notify()
    try {
      const client = await this.server()
      if (attempt !== this.loginAttempt) return
      const login = await client.request(
        "account/login/start",
        { type: "chatgpt" },
        z.object({
          type: z.literal("chatgpt"),
          loginId: z.string(),
          authUrl: z.string().url(),
        }),
      )
      if (attempt !== this.loginAttempt) {
        await client.request(
          "account/login/cancel",
          { loginId: login.loginId },
          z.object({}).passthrough(),
        )
        return
      }
      this.loginId = login.loginId
      const url = new URL(login.authUrl)
      if (
        url.protocol !== "https:" ||
        !["auth.openai.com", "chatgpt.com"].includes(url.hostname)
      )
        throw new Error("Codex returned an invalid sign-in URL.")
      this.loginTimer = setTimeout(() => {
        void this.cancel().catch(() => {})
      }, 300_000)
      await this.openBrowser(login.authUrl)
    } catch (error) {
      if (attempt === this.loginAttempt)
        await this.cancel().catch(() => {})
      throw error
    }
  }

  async cancel() {
    this.loginAttempt++
    const id = this.loginId
    this.loginId = undefined
    clearTimeout(this.loginTimer)
    this.state.connecting = false
    if (id && this.client)
      await this.client.request(
        "account/login/cancel",
        { loginId: id },
        z.object({}).passthrough(),
      )
    this.notify()
  }

  async disconnect() {
    await this.cancel()
    const client = await this.server()
    await client.request("account/logout", {}, z.object({}).passthrough())
    await this.refresh()
  }

  close() {
    this.stopped = true
    this.loginAttempt++
    clearTimeout(this.loginTimer)
    this.startingClient?.close()
    this.client?.close()
    this.client = undefined
  }
}
