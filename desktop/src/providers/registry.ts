import { join } from "node:path"
import { z } from "zod"
import { shell } from "electron"
import { ModelAccount } from "../main/account"
import { CodexProvider } from "./codex"
import {
  ProviderStatusSchema,
  type RunnerSchema,
  type ProviderIdSchema,
} from "../shared/contracts"

const OpenRouterModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().default(""),
      supported_parameters: z.array(z.string()).default([]),
    }),
  ),
})

export class ProviderRegistry {
  readonly openrouter
  readonly codex
  private openrouterState = ProviderStatusSchema.parse({
    id: "openrouter",
    name: "OpenRouter",
    connected: false,
    models: [{ id: "openrouter/auto", name: "Auto", isDefault: true }],
  })

  constructor(
    directory: string,
    executable: string,
    private notify: () => void,
  ) {
    this.openrouter = new ModelAccount(directory)
    this.codex = new CodexProvider(
      { executable, home: join(directory, "providers", "codex") },
      notify,
      (url) => shell.openExternal(url),
    )
  }

  get statuses() {
    return [
      this.codex.state,
      { ...this.openrouterState, connected: this.openrouter.connected },
    ]
  }

  async refresh() {
    await Promise.all([this.codex.refresh(), this.refreshOpenRouter()])
  }

  private async refreshOpenRouter() {
    this.openrouterState.loading = true
    this.openrouterState.error = undefined
    this.notify()
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok)
        throw new Error(
          "Could not load OpenRouter models. Refresh to try again.",
        )
      const result = OpenRouterModelsSchema.parse(await response.json())
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
      this.notify()
    }
  }

  async connect(id: z.infer<typeof ProviderIdSchema>) {
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
    if (id === "codex") await this.codex.cancel()
    else this.openrouter.cancel()
  }

  async disconnect(id: z.infer<typeof ProviderIdSchema>) {
    if (id === "codex") await this.codex.disconnect()
    else await this.openrouter.disconnect()
    this.notify()
  }

  async connection(runner: z.infer<typeof RunnerSchema>) {
    if (runner.provider === "codex") {
      if (!this.codex.state.connected)
        throw new Error(
          "Connect your model account for Codex in Runners to start learning.",
        )
      return { apiKey: "", codex: this.codex.connection }
    }
    try {
      return { apiKey: await this.openrouter.key(), codex: undefined }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        throw new Error(
          "Connect your model account for OpenRouter in Runners to start learning.",
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
      input.provider === "codex" &&
      input.model === "default" &&
      !input.reasoningEffort
    )
      return
    const model = provider.models.find((item) => item.id === input.model)
    if (!model && input.provider === "codex")
      throw new Error(
        "Choose an available Codex model. Refresh providers if it is missing.",
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
    this.openrouter.cancel()
    this.codex.close()
  }
}
