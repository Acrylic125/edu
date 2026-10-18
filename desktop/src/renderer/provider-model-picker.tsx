import { useRef, useState } from "react"
import { Combobox } from "@base-ui/react/combobox"
import { Menu } from "@base-ui/react/menu"
import { Check, ChevronDown, CircleAlert, ChevronRight, Search, Settings, Star } from "lucide-react"
import { Toolbar } from "@base-ui/react/toolbar"
import { z } from "zod"
import {
  providerDefaultModels,
  ProviderIdSchema,
  ProviderModelSchema,
  ProviderStatusSchema,
  ReasoningEffortSchema,
  type RunnerSchema,
} from "../shared/contracts"
import { desktop, desktopErrorMessage, useWorkspace } from "./store"
import { ProviderSetupInstructions } from "./settings/provider-setup"
import { useModelPreferences } from "./model-preferences"
import { ProviderIcon } from "./provider-icon"

const providerNames = {
  codex: "Codex",
  claude: "Claude",
  antigravity: "Antigravity",
  openrouter: "OpenRouter",
}


type ModelSelection = Pick<
  z.infer<typeof RunnerSchema>,
  "provider" | "model" | "reasoningEffort"
>

export function ProviderModelFields({
  value,
  onChange,
  lockProvider = false,
  onSetup,
}: {
  value: ModelSelection
  onChange: (value: ModelSelection) => void
  lockProvider?: boolean
  onSetup: (provider: z.infer<typeof ProviderIdSchema>) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Model</p>
      <ProviderModelPicker value={value} onChange={onChange} lockProvider={lockProvider} onSetup={onSetup} />
    </div>
  )
}

export function ProviderModelPicker({
  value,
  onChange,
  disabled = false,
  lockProvider = false,
  onSetup,
}: {
  value: ModelSelection
  onChange: (value: ModelSelection) => void
  disabled?: boolean
  lockProvider?: boolean
  onSetup: (provider: z.infer<typeof ProviderIdSchema>) => void
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const setupButton = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [browseProvider, setBrowseProvider] = useState<z.infer<typeof ProviderIdSchema>>(value.provider)
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [setupOperation, setSetupOperation] = useState<{ provider: z.infer<typeof ProviderIdSchema>; action: "connect" | "refresh" }>()
  const [setupError, setSetupError] = useState<{ provider: z.infer<typeof ProviderIdSchema>; message: string }>()
  const providers = useWorkspace((state) => state.snapshot.providers)
  const { favorites, toggleFavorite } = useModelPreferences()
  const provider = providers.find((entry) => entry.id === value.provider)
  const catalog = providers.find((entry) => entry.id === browseProvider)
  const needsSetup = !catalog?.connected
  const catalogName = catalog?.name ?? providerNames[browseProvider]
  const providerLocked = lockProvider && browseProvider !== value.provider
  const connecting = catalog?.connecting || (setupOperation?.provider === browseProvider && setupOperation.action === "connect")
  const setupStatus = catalog ?? ProviderStatusSchema.parse({ id: browseProvider, name: catalogName, connected: false, models: [] })
  async function performSetup(action: "connect" | "refresh") {
    const id = browseProvider
    setSetupOperation({ provider: id, action })
    setSetupError(undefined)
    try {
      if (action === "connect") await desktop().connect(id)
      else await desktop().refreshProviders(id)
    } catch (error) {
      setSetupError({ provider: id, message: error instanceof Error ? desktopErrorMessage(error) : "Could not connect. Try again." })
    } finally {
      setSetupOperation(undefined)
    }
  }
  const model = provider?.models.find((entry) => entry.id === value.model)
  const choices = ProviderIdSchema.options.flatMap((id) => {
    const status = providers.find((entry) => entry.id === id)
    const models = (status?.models ?? []).filter((entry) => entry.id !== "default")
    const entries = models.map((entry) => ({
      ...entry,
      provider: id,
      providerName: status?.name ?? providerNames[id],
      unavailable: false,
    }))
    if (id === "openrouter" && !entries.some((entry) => entry.id === "openrouter/auto")) {
      entries.push({
        ...ProviderModelSchema.parse({ id: "openrouter/auto", name: "Auto" }),
        provider: id,
        providerName: status?.name ?? providerNames[id],
        unavailable: false,
      })
    }
    if (value.provider === id && !entries.some((entry) => entry.id === value.model)) {
      entries.unshift({
        ...ProviderModelSchema.parse({
          id: value.model,
          name: value.model,
          description: "This model is no longer in the provider’s catalog",
        }),
        provider: id,
        providerName: status?.name ?? providerNames[id],
        unavailable: true,
      })
    }
    return entries.map((entry) => ({
      ...entry,
      favorite: favorites.some((favorite) => favorite.provider === id && favorite.model === entry.id),
    }))
  })
  const availableChoices = choices.filter((entry) => {
    if (needsSetup || (lockProvider && entry.provider !== value.provider)) return false
    return entry.provider === browseProvider
  })
  function priority(entry: typeof choices[number]) {
    if (entry.provider === value.provider && entry.id === value.model) return 3
    if (entry.favorite) return 2
    if (entry.id === providerDefaultModels[entry.provider]) return 1
    return 0
  }
  const primary = availableChoices
    .toSorted((a, b) => priority(b) - priority(a)).slice(0, 3)
  const more = availableChoices.filter((entry) => !primary.includes(entry))
  let matches = primary
  const query = search.trim().toLowerCase()
  if (query) {
    matches = availableChoices.filter((entry) =>
      `${entry.name} ${entry.id} ${entry.providerName}`.toLowerCase().includes(query),
    )
  } else if (expanded) {
    matches = [...primary, ...more]
  }
  const shortcuts = matches.filter((entry) => !entry.unavailable).slice(0, 3)
  const shortcutModifier = navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"

  function selectModel(selected: typeof choices[number]) {
    if (selected.unavailable || !providers.some((provider) => provider.id === selected.provider && provider.connected) || (lockProvider && selected.provider !== value.provider)) return
    let reasoningEffort = value.reasoningEffort
    if (value.provider !== selected.provider || value.model !== selected.id) reasoningEffort = undefined
    onChange({ provider: selected.provider, model: selected.id, reasoningEffort })
    setOpen(false)
  }
  let label = model?.name ?? value.model
  if (value.model === "openrouter/auto") label = "Auto"
  const effort = value.reasoningEffort ?? model?.defaultReasoningEffort
  let effortLabel = "Auto"
  if (effort) effortLabel = effort.charAt(0).toUpperCase() + effort.slice(1)
  let emptyLabel = "No matching models"
  if (catalog?.loading) emptyLabel = "Loading models…"

  return (
    <div ref={anchor} className="flex min-w-0 items-center gap-0.5">
      <Combobox.Root
        items={matches}
        filter={null}
        value={choices.find((entry) => entry.provider === value.provider && entry.id === value.model) ?? null}
        itemToStringLabel={(entry) => entry.name}
        isItemEqualToValue={(entry, selected) => entry.provider === selected.provider && entry.id === selected.id}
        inputValue={search}
        onInputValueChange={setSearch}
        open={open && !disabled}
        autoHighlight
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setBrowseProvider(value.provider)
            setSearch("")
            setExpanded(false)
          }
        }}
        onValueChange={(selected) => {
          if (selected) selectModel(selected)
        }}
      >
        <Combobox.Trigger
          aria-label="Choose provider and model"
          disabled={disabled}
          title={provider?.error ?? `${provider?.name ?? value.provider}: ${label}`}
          data-error={provider?.error ? "" : undefined}
          className="flex h-7 max-w-56 min-w-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground disabled:opacity-50 data-error:bg-destructive/10 data-error:text-destructive data-error:hover:bg-destructive/15 data-error:hover:text-destructive data-error:data-popup-open:bg-destructive/15 data-error:data-popup-open:text-destructive"
        >
          {provider?.error && <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />}
          {!provider?.error && <ProviderIcon provider={value.provider} className="size-3.5 shrink-0" />}
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0" />
        </Combobox.Trigger>
        <Combobox.Portal
          container={anchor.current?.closest("dialog") ?? undefined}
        >
          <Combobox.Positioner
            side="top"
            align="start"
            sideOffset={8}
            className="z-50"
          >
            <Combobox.Popup
              aria-label="Choose a model"
              initialFocus={needsSetup ? setupButton : searchInput}
              className="flex h-96 max-h-[var(--available-height)] w-[23rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
              onKeyDown={(event) => {
                if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return
                const index = ["1", "2", "3"].indexOf(event.key)
                const selected = shortcuts[index]
                if (!selected) return
                event.preventDefault()
                selectModel(selected)
              }}
            >
              <Toolbar.Root
                orientation="vertical"
                aria-label="Model providers"
                className="flex w-12 shrink-0 flex-col gap-1 border-r border-border/60 bg-muted/20 p-1.5"
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault()
                    if (needsSetup) setupButton.current?.focus()
                    else searchInput.current?.focus()
                  }
                }}
              >
                {ProviderIdSchema.options.map((id) => {
                  const status = providers.find((provider) => provider.id === id)
                  const name = status?.name ?? providerNames[id]
                  let connection = "Setup required"
                  if (status?.connected) connection = "Connected"
                  else if (status?.connecting) connection = "Connecting…"
                  else if (status?.loading) connection = "Checking…"
                  let title = `${name}: ${connection}`
                  if (lockProvider && id !== value.provider && status?.connected) title += " · Start a new chat to use this provider"
                  return (
                    <Toolbar.Button
                      key={id}
                      aria-label={name}
                      aria-description={connection}
                      aria-pressed={browseProvider === id}
                      title={title}
                      className="relative flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:text-foreground aria-pressed:after:absolute aria-pressed:after:-right-1.5 aria-pressed:after:h-5 aria-pressed:after:w-0.5 aria-pressed:after:rounded-l aria-pressed:after:bg-primary"
                      onClick={() => {
                        setBrowseProvider(id)
                        setSearch("")
                        setExpanded(false)
                        if (status?.connected) searchInput.current?.focus()
                      }}
                    >
                      <ProviderIcon provider={id} className={`size-5 shrink-0 ${status?.connected ? "" : "grayscale opacity-35"}`} />
                      {status?.connected && <span aria-hidden="true" className="absolute bottom-1 right-1 size-1.5 rounded-full bg-emerald-500 ring-2 ring-popover" />}
                    </Toolbar.Button>
                  )
                })}
              </Toolbar.Root>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {needsSetup && (
                  <section aria-label={`Set up ${catalogName}`} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
                    <h2 className="text-sm font-medium">Setup</h2>
                    <div className="my-auto py-5">
                      <ProviderIcon provider={browseProvider} className="mb-3 size-7 grayscale opacity-50" />
                      <h3 className="text-sm font-medium">Set up {catalogName}</h3>
                      <div className="text-xs"><ProviderSetupInstructions provider={setupStatus} disabled={setupOperation !== undefined} onRefresh={() => { void performSetup("refresh") }} /></div>
                      <button
                        ref={setupButton}
                        type="button"
                        disabled={setupOperation !== undefined || catalog?.connecting}
                        className="mt-4 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        onClick={() => { void performSetup("connect") }}
                      >
                        {connecting ? "Connecting…" : "Connect"}
                      </button>
                      <button
                        type="button"
                        className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setOpen(false)
                          onSetup(browseProvider)
                        }}
                      >
                        <Settings aria-hidden="true" className="size-3" />
                        Open provider settings
                      </button>
                    </div>
                    {setupError?.provider === browseProvider && <p role="alert" className="text-xs text-destructive">{setupError.message}</p>}
                    {catalog?.error && setupError?.provider !== browseProvider && <p role="status" className="text-xs text-destructive">{catalog.error}</p>}
                  </section>
                )}
                {!needsSetup && providerLocked && (
                  <section aria-label={`${catalogName} connected`} className="flex flex-1 flex-col px-4 py-4">
                    <h2 className="text-sm font-medium">Connected</h2>
                    <div className="my-auto py-5">
                      <Check aria-hidden="true" className="mb-3 size-7 text-emerald-500" />
                      <p className="text-sm font-medium">Start a new chat to use {catalogName}.</p>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">This chat keeps its current provider.</p>
                    </div>
                  </section>
                )}
                {!needsSetup && !providerLocked && (
                  <>
                    <div className="mx-3 mb-2 mt-1.5 flex shrink-0 items-center gap-2 border-b border-border px-0.5 focus-within:border-primary">
                      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <Combobox.Input
                        ref={searchInput}
                        aria-label="Search models"
                        placeholder="Search models…"
                        className="h-10 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-none"
                      />
                    </div>
                    <Combobox.Empty className="text-center text-xs text-muted-foreground">
                      <p className="px-5 py-8">
                        {emptyLabel}
                      </p>
                    </Combobox.Empty>
                    <div className="min-h-0 flex-1 scroll-py-1 overflow-y-auto overscroll-contain">
                      <Combobox.List
                        className="px-2 pb-1"
                        aria-label="Models"
                      >
                        {matches.map((entry) => {
                          const shortcut = shortcuts.indexOf(entry)
                          return (
                            <div key={`${entry.provider}:${entry.id}`} className="group relative">
                              <Combobox.Item
                                value={entry}
                                disabled={entry.unavailable}
                                aria-label={entry.name}
                                title={entry.description || entry.name}
                                className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md py-2 pl-2.5 pr-9 text-[13px] outline-none data-highlighted:bg-accent data-selected:bg-accent/60 data-disabled:cursor-default data-disabled:opacity-50"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate font-medium">{entry.name}</span>
                                  </div>
                                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <ProviderIcon provider={entry.provider} className="size-3 shrink-0 opacity-60" />
                                    <span className="truncate">{entry.providerName}</span>
                                    {entry.unavailable && <span>· Unavailable</span>}
                                  </span>
                                </div>
                                {shortcut >= 0 && <kbd className="shrink-0 rounded bg-foreground/5 px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground">{shortcutModifier}{shortcut + 1}</kbd>}
                                <Combobox.ItemIndicator><Check className="size-3.5 shrink-0 text-primary" /></Combobox.ItemIndicator>
                              </Combobox.Item>
                              <button
                                type="button"
                                aria-label={`Favorite ${entry.name} from ${entry.providerName}`}
                                aria-pressed={entry.favorite}
                                title={entry.favorite ? "Remove from favorites" : "Add to favorites"}
                                className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/60 hover:bg-foreground/5 hover:text-foreground aria-pressed:text-primary"
                                onClick={() => toggleFavorite({ provider: entry.provider, model: entry.id })}
                              >
                                <Star aria-hidden="true" className={`size-3.5 ${entry.favorite ? "fill-current" : ""}`} />
                              </button>
                            </div>
                          )
                        })}
                      </Combobox.List>
                      {!query && more.length > 0 && (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          className="mx-2 mb-2 flex w-[calc(100%-1rem)] shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-accent"
                          onClick={() => setExpanded(!expanded)}
                        >
                          <span className="flex-1">
                            <span className="block font-medium">More models</span>
                            <span className="text-xs text-muted-foreground">{more.length} models</span>
                          </span>
                          <ChevronRight aria-hidden="true" className={`size-4 text-muted-foreground ${expanded ? "rotate-90" : ""}`} />
                        </button>
                      )}
                    </div>
                    {catalog?.error && (
                      <p role="status" className="border-t border-border/60 px-3 py-2.5 text-xs text-destructive">
                        {catalog.error}
                      </p>
                    )}
                  </>
                )}
              </div>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {value.provider === "codex" &&
        model &&
        model.reasoningEfforts.length > 0 && (
          <>
            <span aria-hidden="true" className="h-3 w-px bg-border" />
            <Menu.Root>
              <Menu.Trigger
                aria-label="Choose reasoning effort"
                disabled={disabled}
                className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground disabled:opacity-50"
              >
                {effortLabel}
                <ChevronDown className="size-3" />
              </Menu.Trigger>
              <Menu.Portal
                container={anchor.current?.closest("dialog") ?? undefined}
              >
                <Menu.Positioner
                  side="top"
                  align="start"
                  sideOffset={8}
                  className="z-50"
                >
                  <Menu.Popup
                    aria-label="Reasoning effort"
                    className="min-w-40 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
                  >
                    <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                      Reasoning effort
                    </div>
                    <Menu.RadioGroup
                      value={value.reasoningEffort ?? "auto"}
                      onValueChange={(next) => {
                        const effort = ReasoningEffortSchema.safeParse(next)
                        onChange({
                          ...value,
                          reasoningEffort: effort.success
                            ? effort.data
                            : undefined,
                        })
                      }}
                    >
                      {["auto", ...model.reasoningEfforts].map((choice) => {
                        let name =
                          choice.charAt(0).toUpperCase() + choice.slice(1)
                        if (choice === "auto" && model.defaultReasoningEffort)
                          name = `Auto (${model.defaultReasoningEffort})`
                        return (
                          <Menu.RadioItem
                            key={choice}
                            value={choice}
                            closeOnClick
                            aria-label={
                              choice === "auto"
                                ? "Auto reasoning"
                                : `${choice} reasoning`
                            }
                            className="flex h-8 cursor-pointer items-center justify-between gap-4 rounded-md px-2 text-xs outline-none data-highlighted:bg-accent"
                          >
                            {name}
                            <Menu.RadioItemIndicator>
                              <Check className="size-3.5" />
                            </Menu.RadioItemIndicator>
                          </Menu.RadioItem>
                        )
                      })}
                    </Menu.RadioGroup>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </>
        )}
    </div>
  )
}
