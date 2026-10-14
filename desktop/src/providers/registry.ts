import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { shell } from "electron"
import { ModelAccount } from "../main/account"
import { CodexProvider } from "./codex"
import { cliPromptArguments, parseCliResponse, prepareCliWorkspace, resolveCliExecutable, runCliCommand } from "./cli"
import {
  ProviderModelSchema,
  ProviderStatusSchema,
  ProviderSettingsSchema,
  type RunnerSchema,
  ProviderIdSchema,
} from "../shared/contracts"

const OpenRouterModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().default(""),
      supported_parameters: z.array(z.string()).default([]),
      architecture: z.object({
        input_modalities: z.array(z.string()),
        output_modalities: z.array(z.string()),
      }),
      pricing: z.object({
        prompt: z.string().pipe(z.coerce.number<string>().finite().nonnegative()),
        completion: z.string().pipe(z.coerce.number<string>().finite().nonnegative()),
        request: z.string().pipe(z.coerce.number<string>().finite().nonnegative()).optional().default(0),
      }).optional().catch(undefined),
    }),
  ),
})

export class ProviderRegistry {
  private pollingTimer?: ReturnType<typeof setInterval>
  private refreshTasks = new Map<z.infer<typeof ProviderIdSchema>, Promise<void>>()
  private disconnecting = new Set<z.infer<typeof ProviderIdSchema>>()
  private closed = false
  private titleModel?: z.infer<typeof ProviderModelSchema>
  readonly openrouter
  codex
  private settings: z.infer<typeof ProviderSettingsSchema>[] = []
  private cliAbort = new AbortController()
  private cliStates = ["claude", "antigravity"].map((id) => ProviderStatusSchema.parse({
    id, name: id === "claude" ? "Claude" : "Antigravity", connected: false,
    models: [{ id: "default", name: "Default model", isDefault: true }],
  }))
  private openrouterState = ProviderStatusSchema.parse({
    id: "openrouter",
    name: "OpenRouter",
    connected: false,
    installed: true,
    models: [{ id: "openrouter/auto", name: "Auto", isDefault: true }],
  })

  constructor(
    private directory: string,
    private executable: string,
    private notify: () => void,
    settings: z.infer<typeof ProviderSettingsSchema>[] = [],
  ) {
    this.settings = settings
    for (const provider of this.cliStates)
      provider.connected = settings.some((item) => item.id === provider.id && item.enabled && item.binaryPath)
    this.openrouter = new ModelAccount(directory)
    this.codex = new CodexProvider(
      { executable: settings.find((item) => item.id === "codex")?.binaryPath || executable, home: join(directory, "providers", "codex") },
      notify,
      (url) => shell.openExternal(url),
    )
  }

  get statuses() {
    return [
      this.codex.state,
      { ...this.openrouterState, connected: this.openrouter.connected },
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

  async refresh(id?: z.infer<typeof ProviderIdSchema>) {
    if (this.closed) return
    let ids = ProviderIdSchema.options
    if (id) ids = [id]
    await Promise.all(ids.map((id) => {
      const pending = this.refreshTasks.get(id)
      if (pending) return pending
      if (this.disconnecting.has(id) || this.statuses.some((provider) => provider.id === id && provider.connecting)) return
      const task = (async () => {
        try {
          if (id === "codex") await this.codex.refresh()
          else if (id === "openrouter") await this.refreshOpenRouter()
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
        provider.models = ["default", "sonnet", "opus", "haiku"].map((id) => ProviderModelSchema.parse({ id, name: id === "default" ? "Default model" : id[0].toUpperCase() + id.slice(1), isDefault: id === "default" }))
      } else {
        const output = await runCliCommand(connection, ["models"], "", undefined, 15_000, this.cliAbort.signal)
        const models = output.split("\n").flatMap((line) => {
          const match = /^\s*([a-z][a-z0-9.-]+)\s{2,}(.+?)\s*$/.exec(line)
          if (!match) return []
          return [ProviderModelSchema.parse({ id: match[1], name: match[2] })]
        })
        provider.models = [ProviderModelSchema.parse({ id: "default", name: "Default model", isDefault: true }), ...models]
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

  private async refreshOpenRouter() {
    this.openrouterState.loading = true
    this.openrouterState.error = undefined
    this.notify()
    try {
      const previouslyConnected = this.openrouter.connected
      await this.openrouter.load()
      const hasKey = this.openrouter.connected
      this.openrouter.connected = previouslyConnected && hasKey
      if (hasKey) {
        const key = await this.openrouter.key()
        const account = await fetch("https://openrouter.ai/api/v1/key", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.any([this.cliAbort.signal, AbortSignal.timeout(15_000)]),
        })
        if (account.status === 401 || account.status === 403) {
          this.openrouter.connected = false
          throw new Error("OpenRouter sign-in has expired. Click Connect to sign in again.")
        }
        if (!account.ok) throw new Error("Could not check OpenRouter. Refresh to try again.")
        z.object({ data: z.object({ is_free_tier: z.boolean() }) }).parse(await account.json())
        this.openrouter.connected = true
      }
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        signal: AbortSignal.any([this.cliAbort.signal, AbortSignal.timeout(20_000)]),
      })
      if (!response.ok)
        throw new Error(
          "Could not load OpenRouter models. Refresh to try again.",
        )
      const result = OpenRouterModelsSchema.parse(await response.json())
      const cheapest = result.data
        .filter((model) =>
          model.id !== "openrouter/auto" &&
          model.pricing &&
          model.architecture.input_modalities.includes("text") &&
          model.architecture.output_modalities.includes("text"),
        )
        .sort((left, right) => {
          if (!left.pricing || !right.pricing) return 0
          // Estimate a short title request: 500 input tokens and 40 output tokens.
          const leftCost = left.pricing.prompt * 500 + left.pricing.completion * 40 + left.pricing.request
          const rightCost = right.pricing.prompt * 500 + right.pricing.completion * 40 + right.pricing.request
          return leftCost - rightCost || left.id.localeCompare(right.id)
        })[0]
      this.titleModel = undefined
      if (cheapest)
        this.titleModel = ProviderModelSchema.parse({
          id: cheapest.id,
          name: cheapest.name,
        })
      this.openrouterState.models = [
        {
          id: "openrouter/auto",
          name: "Auto",
          description: "Choose a model automatically",
          isDefault: true,
          reasoningEfforts: [],
        },
        ...result.data
          .filter(
            (model) =>
              model.id !== "openrouter/auto" &&
              model.supported_parameters.includes("tools"),
          )
          .map((model) => ({
            id: model.id,
            name: model.name,
            description: model.description,
            isDefault: false,
            reasoningEfforts: [],
          })),
      ]
    } catch (error) {
      this.openrouterState.error =
        error instanceof Error
          ? error.message
          : "Could not load OpenRouter models."
    } finally {
      this.openrouterState.loading = false
      this.openrouterState.checkedAt = new Date().toISOString()
      this.notify()
    }
  }

  async connect(id: z.infer<typeof ProviderIdSchema>) {
    if (this.disconnecting.has(id)) throw new Error("Wait for this provider to finish disconnecting.")
    await this.refreshTasks.get(id)
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
      await this.codex.connect()
      return
    }
    this.openrouterState.connecting = true
    this.notify()
    try {
      await this.openrouter.connect()
    } finally {
      this.openrouterState.connecting = false
      this.notify()
    }
  }

  async cancel(id: z.infer<typeof ProviderIdSchema>) {
    if (id === "claude" || id === "antigravity") return
    if (id === "codex") await this.codex.cancel()
    else this.openrouter.cancel()
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
      else await this.openrouter.disconnect()
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
    try {
      return { apiKey: await this.openrouter.key(), codex: undefined, titleModel: this.titleModel }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        throw new Error(
          "Connect your model account for OpenRouter in Settings → Providers to start learning.",
        )
      throw error
    }
  }

  validateRunner(
    input:
      z.infer<typeof RunnerSchema> | Omit<z.infer<typeof RunnerSchema>, "id">,
  ) {
    const provider = this.statuses.find((item) => item.id === input.provider)
    if (!provider) throw new Error("Provider not found.")
    if (
      input.provider !== "openrouter" &&
      input.model === "default" &&
      !input.reasoningEffort
    )
      return
    const model = provider.models.find((item) => item.id === input.model)
    if (!model && input.provider !== "openrouter")
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
    this.openrouter.cancel()
    this.codex.close()
  }
}
