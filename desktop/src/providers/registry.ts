import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { shell } from "electron"
import { CodexProvider } from "./codex"
import { cliPromptArguments, parseCliResponse, prepareCliWorkspace, resolveCliExecutable, runCliCommand } from "./cli"
import {
  providerDefaultModels,
  ProviderModelSchema,
  ProviderStatusSchema,
  ProviderSettingsSchema,
  type RunnerSchema,
  ProviderIdSchema,
} from "../shared/contracts"

export class ProviderRegistry {
  private pollingTimer?: ReturnType<typeof setInterval>
  private refreshTasks = new Map<z.infer<typeof ProviderIdSchema>, Promise<void>>()
  private disconnecting = new Set<z.infer<typeof ProviderIdSchema>>()
  private closed = false
  codex
  private settings: z.infer<typeof ProviderSettingsSchema>[] = []
  private cliAbort = new AbortController()
  private cliStates = ["claude", "antigravity"].map((id) => ProviderStatusSchema.parse({
    id, name: id === "claude" ? "Claude" : "Antigravity", connected: false,
    models: [],
  }))
  constructor(
    private directory: string,
    private executable: string,
    private notify: () => void,
    settings: z.infer<typeof ProviderSettingsSchema>[] = [],
  ) {
    this.settings = settings
    for (const provider of this.cliStates)
      provider.connected = settings.some((item) => item.id === provider.id && item.enabled && item.binaryPath)
    this.codex = new CodexProvider(
      { executable: settings.find((item) => item.id === "codex")?.binaryPath || executable, home: join(directory, "providers", "codex") },
      notify,
      (url) => shell.openExternal(url),
    )
  }

  get statuses() {
    return [
      this.codex.state,
      ...this.cliStates,
    ].map((provider) => {
      const settings = this.settings.find((item) => item.id === provider.id)
      return { ...provider, settings, name: settings?.displayName ?? provider.name }
    })
  }

  configure(settings: z.infer<typeof ProviderSettingsSchema>) {
    this.settings = [...this.settings.filter((item) => item.id !== settings.id), settings]
    const cli = this.cliStates.find((item) => item.id === settings.id)
    if (cli) {
      cli.connected = settings.enabled && cli.connected
      cli.error = undefined
    }
    if (settings.id === "codex" && this.codex.connection.executable !== (settings.binaryPath || this.executable)) {
      this.codex.close()
      this.codex = new CodexProvider(
        { executable: settings.binaryPath || this.executable, home: join(this.directory, "providers", "codex") },
        this.notify,
        (url) => shell.openExternal(url),
      )
    }
  }

  startPolling() {
    if (this.closed || this.pollingTimer) return
    const check = () => { void this.refresh().catch(() => {}) }
    check()
    this.pollingTimer = setInterval(check, 5 * 60_000)
    this.pollingTimer.unref()
  }

  private reconcileCodex() {
    if (this.closed) throw new Error("EdU is shutting down.")
    if (!this.codex.closed) return
    this.codex = new CodexProvider(
      this.codex.connection,
      this.notify,
      (url) => shell.openExternal(url),
    )
  }

  async refresh(id?: z.infer<typeof ProviderIdSchema>) {
    if (this.closed) return
    let ids = ProviderIdSchema.options
    if (id) ids = [id]
    await Promise.all(ids.map(async (id) => {
      const pending = this.refreshTasks.get(id)
      if (pending) {
        await pending
        const recovery = this.refreshTasks.get(id)
        if (recovery) return recovery
        if (this.closed || id !== "codex" || !this.codex.closed) return
      }
      if (id === "codex") this.reconcileCodex()
      if (this.disconnecting.has(id) || this.statuses.some((provider) => provider.id === id && provider.connecting)) return
      const task = (async () => {
        try {
          if (id === "codex") await this.codex.refresh()
          else {
            const provider = this.cliStates.find((provider) => provider.id === id)
            if (provider) await this.refreshCli(provider)
          }
        } finally {
          this.refreshTasks.delete(id)
        }
      })()
      this.refreshTasks.set(id, task)
      return task
    }))
  }

  private cliConnection(id: "claude" | "antigravity") {
    const settings = this.settings.find((item) => item.id === id)
    if (!settings?.binaryPath)
      throw new Error("Set the provider's binary path in Settings → Providers first.")
    return { provider: id, executable: settings.binaryPath, directory: join(this.directory, "providers", id) }
  }

  private async refreshCli(provider: z.infer<typeof ProviderStatusSchema>) {
    if (provider.id !== "claude" && provider.id !== "antigravity") return
    provider.loading = true
    provider.error = undefined
    this.notify()
    try {
      let executable: string
      try {
        executable = await resolveCliExecutable(provider.id, this.settings.find((item) => item.id === provider.id)?.binaryPath)
      } catch {
        provider.installed = false
        provider.connected = false
        provider.account = undefined
        return
      }
      provider.installed = true
      const connection = { provider: provider.id, executable, directory: join(this.directory, "providers", provider.id) }
      await mkdir(connection.directory, { recursive: true, mode: 0o700 })
      if (provider.id === "claude") {
        const status = z.object({ loggedIn: z.boolean(), authMethod: z.string().optional(), email: z.string().optional() }).parse(JSON.parse(await runCliCommand(connection, ["auth", "status"], "", undefined, 15_000, this.cliAbort.signal)))
        provider.connected = status.loggedIn && status.authMethod === "claude.ai" && this.settings.some((item) => item.id === "claude" && item.enabled)
        provider.account = status.email
        provider.models = [
          { id: providerDefaultModels.claude, name: "Haiku 5.5" },
          { id: "sonnet", name: "Sonnet" },
          { id: "opus", name: "Opus" },
        ].map((model) => ProviderModelSchema.parse(model))
      } else {
        const output = await runCliCommand(connection, ["models"], "", undefined, 15_000, this.cliAbort.signal)
        const models = output.split("\n").flatMap((line) => {
          const match = /^\s*([a-z][a-z0-9.-]+)(?:\t+| {2,})(.+?)\s*$/.exec(line)
          if (!match) return []
          return [ProviderModelSchema.parse({ id: match[1], name: match[2] })]
        })
        provider.models = models
        if (this.settings.some((item) => item.id === "antigravity" && item.enabled)) {
          // /usage refreshes account quotas without generating a model response or starting sign-in.
          const usage = await runCliCommand(connection, ["--print", "/usage"], "", undefined, 15_000, this.cliAbort.signal)
          if (!usage.trim()) throw new Error("Could not check Antigravity. Refresh to try again.")
          provider.connected = this.settings.some((item) => item.id === "antigravity" && item.enabled)
        } else {
          provider.connected = false
        }
      }
    } catch (error) {
      provider.connected = false
      provider.error = error instanceof Error ? error.message : "Could not refresh the CLI provider."
    } finally {
      provider.loading = false
      provider.checkedAt = new Date().toISOString()
      this.notify()
    }
  }

  async connect(id: z.infer<typeof ProviderIdSchema>) {
    if (this.closed) throw new Error("EdU is shutting down.")
    if (this.disconnecting.has(id)) throw new Error("Wait for this provider to finish disconnecting.")
    await this.refreshTasks.get(id)
    if (this.closed) throw new Error("EdU is shutting down.")
    if (id === "claude" || id === "antigravity") {
      const provider = this.cliStates.find((item) => item.id === id)
      if (!provider) throw new Error("Provider not found.")
      provider.connecting = true
      this.notify()
      try {
        const connection = this.cliConnection(id)
        await prepareCliWorkspace(connection)
        if (id === "claude") {
          const schema = z.object({ loggedIn: z.boolean(), authMethod: z.string().optional() })
          let status = schema.parse({ loggedIn: false })
          try {
            status = schema.parse(JSON.parse(await runCliCommand(connection, ["auth", "status"], "", undefined, 15_000, this.cliAbort.signal)))
          } catch {
            // Claude exits with status 1 when signed out; Connect starts its browser login.
          }
          if (!status.loggedIn || status.authMethod !== "claude.ai") {
            await runCliCommand(connection, ["auth", "login"], "", undefined, 5 * 60_000, this.cliAbort.signal)
            status = schema.parse(JSON.parse(await runCliCommand(connection, ["auth", "status"], "", undefined, 15_000, this.cliAbort.signal)))
            if (!status.loggedIn || status.authMethod !== "claude.ai")
              throw new Error("Sign-in was not completed. Click Connect to try again.")
          }
        } else {
          const schema = z.object({ ready: z.boolean() })
          const result = await runCliCommand(connection, cliPromptArguments(connection, JSON.stringify(z.toJSONSchema(schema))), "Return ready=true.", undefined, 5 * 60_000, this.cliAbort.signal)
          if (!schema.parse(parseCliResponse(id, result)).ready) throw new Error("Antigravity is not ready. Sign in with agy and try again.")
        }
        const settings = this.settings.find((item) => item.id === id)
        if (settings) settings.enabled = true
        provider.connected = true
        provider.installed = true
        provider.checkedAt = new Date().toISOString()
        provider.error = undefined
      } finally {
        provider.connecting = false
        this.notify()
      }
      return
    }
    if (id === "codex") {
      this.reconcileCodex()
      await this.codex.connect()
      return
    }
  }

  async cancel(id: z.infer<typeof ProviderIdSchema>) {
    if (id === "claude" || id === "antigravity") return
    if (id === "codex") await this.codex.cancel()
  }

  async disconnect(id: z.infer<typeof ProviderIdSchema>) {
    this.disconnecting.add(id)
    try {
      // Let a pending check finish before disconnecting so its result cannot restore the account.
      await this.refreshTasks.get(id)
      if (id === "claude" || id === "antigravity") {
        const settings = this.settings.find((item) => item.id === id)
        if (settings) settings.enabled = false
        const provider = this.cliStates.find((item) => item.id === id)
        if (provider) provider.connected = false
        this.notify()
        return
      }
      if (id === "codex") await this.codex.disconnect()
      this.notify()
    } finally {
      this.disconnecting.delete(id)
    }
  }

  async connection(runner: z.infer<typeof RunnerSchema>) {
    if (runner.provider === "claude" || runner.provider === "antigravity") {
      const provider = this.cliStates.find((item) => item.id === runner.provider)
      if (!provider?.connected) throw new Error("Connect your model account in Settings → Providers to start learning.")
      return { apiKey: "", codex: undefined, cli: this.cliConnection(runner.provider) }
    }
    if (runner.provider === "codex") {
      if (!this.codex.state.connected)
        throw new Error(
          "Connect your model account for Codex in Settings → Providers to start learning.",
        )
      return { apiKey: "", codex: this.codex.connection }
    }
    throw new Error("Provider not found.")
  }

  validateRunner(
    input:
      z.infer<typeof RunnerSchema> | Omit<z.infer<typeof RunnerSchema>, "id">,
  ) {
    const provider = this.statuses.find((item) => item.id === input.provider)
    if (!provider) throw new Error("Provider not found.")
    const model = provider.models.find((item) => item.id === input.model)
    if (!model)
      throw new Error(
        "Choose an available model. Refresh providers if it is missing.",
      )
    if (
      input.reasoningEffort &&
      !model?.reasoningEfforts.includes(input.reasoningEffort)
    )
      throw new Error(
        "The selected model does not support that reasoning effort.",
      )
  }

  close() {
    this.closed = true
    clearInterval(this.pollingTimer)
    this.pollingTimer = undefined
    this.cliAbort.abort()
    this.codex.close()
  }
}
