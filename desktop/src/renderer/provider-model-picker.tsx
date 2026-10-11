import { useRef, useState } from "react"
import { Combobox } from "@base-ui/react/combobox"
import { Menu } from "@base-ui/react/menu"
import { Check, ChevronDown, Search } from "lucide-react"
import { z } from "zod"
import {
  ProviderIdSchema,
  ReasoningEffortSchema,
  type RunnerSchema,
} from "../shared/contracts"
import { useWorkspace } from "./store"

type ModelSelection = Pick<
  z.infer<typeof RunnerSchema>,
  "provider" | "model" | "reasoningEffort"
>

export function ProviderModelFields({
  value,
  onChange,
  lockProvider = false,
}: {
  value: ModelSelection
  onChange: (value: ModelSelection) => void
  lockProvider?: boolean
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Model</p>
      <ProviderModelPicker
        value={value}
        onChange={onChange}
        lockProvider={lockProvider}
      />
    </div>
  )
}

export function ProviderModelPicker({
  value,
  onChange,
  disabled = false,
  lockProvider = false,
}: {
  value: ModelSelection
  onChange: (value: ModelSelection) => void
  disabled?: boolean
  lockProvider?: boolean
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [browseProvider, setBrowseProvider] = useState(value.provider)
  const [search, setSearch] = useState("")
  const providers = useWorkspace((state) => state.snapshot.providers)
  const provider = providers.find((entry) => entry.id === value.provider)
  const catalog = providers.find((entry) => entry.id === browseProvider)
  const model = provider?.models.find((entry) => entry.id === value.model)
  const automatic = browseProvider === "codex" ? "default" : "openrouter/auto"
  const choices = [
    {
      id: automatic,
      name: browseProvider === "codex" ? "Default model" : "Auto",
      isDefault: false,
      unavailable: false,
    },
    ...(catalog?.models ?? [])
      .filter((entry) => entry.id !== automatic)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        isDefault: entry.isDefault,
        unavailable: false,
      })),
  ]
  if (
    value.provider === browseProvider &&
    !choices.some((entry) => entry.id === value.model)
  ) {
    choices.push({
      id: value.model,
      name: value.model,
      isDefault: false,
      unavailable: true,
    })
  }
  const matches = choices.filter((entry) =>
    `${entry.name} ${entry.id}`.toLowerCase().includes(search.toLowerCase()),
  )
  let label = model?.name ?? value.model
  if (value.model === "default") label = "Default model"
  if (value.model === "openrouter/auto") label = "Auto"
  const effort = value.reasoningEffort ?? model?.defaultReasoningEffort
  let effortLabel = "Auto"
  if (effort) effortLabel = effort.charAt(0).toUpperCase() + effort.slice(1)

  return (
    <div ref={anchor} className="flex min-w-0 items-center gap-0.5">
      <Combobox.Root
        items={matches}
        filter={null}
        value={
          value.provider === browseProvider
            ? (choices.find((entry) => entry.id === value.model) ?? null)
            : null
        }
        itemToStringLabel={(entry) => entry.name}
        isItemEqualToValue={(entry, selected) => entry.id === selected.id}
        inputValue={search}
        onInputValueChange={setSearch}
        open={open && !disabled}
        autoHighlight
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setBrowseProvider(value.provider)
            setSearch("")
          }
        }}
        onValueChange={(selected) => {
          if (!selected || selected.unavailable) return
          let reasoningEffort = value.reasoningEffort
          if (value.provider !== browseProvider || value.model !== selected.id)
            reasoningEffort = undefined
          onChange({
            provider: browseProvider,
            model: selected.id,
            reasoningEffort,
          })
          setOpen(false)
        }}
      >
        <Combobox.Trigger
          aria-label="Choose provider and model"
          disabled={disabled}
          title={`${provider?.name ?? value.provider}: ${label}`}
          className="flex h-7 max-w-56 min-w-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground disabled:opacity-50"
        >
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
              initialFocus={searchInput}
              className="w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
            >
              <div
                className="flex items-center gap-1 border-b border-border/60 px-2 pt-1.5"
                role="group"
                aria-label="Model providers"
              >
                {ProviderIdSchema.options.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={browseProvider === id}
                    disabled={lockProvider && id !== value.provider}
                    title={
                      lockProvider && id !== value.provider
                        ? "This topic keeps its provider"
                        : undefined
                    }
                    className="relative px-2 pb-2 pt-1 text-xs text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:after:absolute aria-pressed:after:inset-x-2 aria-pressed:after:bottom-0 aria-pressed:after:h-0.5 aria-pressed:after:rounded-full aria-pressed:after:bg-primary disabled:opacity-35"
                    onClick={() => {
                      setBrowseProvider(id)
                      setSearch("")
                      searchInput.current?.focus()
                    }}
                  >
                    {id === "codex" ? "Codex" : "OpenRouter"}
                  </button>
                ))}
              </div>
              <div className="mx-2 my-1.5 flex items-center gap-2 rounded-md bg-muted/40 px-2 focus-within:ring-1 focus-within:ring-border">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <Combobox.Input
                  ref={searchInput}
                  aria-label="Search models"
                  placeholder="Search models…"
                  className="h-8 w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground focus-visible:outline-none"
                />
              </div>
              <Combobox.Empty className="text-center text-xs text-muted-foreground">
                <p className="px-3 py-5">
                  {catalog?.loading ? "Loading models…" : "No matching models"}
                </p>
              </Combobox.Empty>
              <Combobox.List
                className="max-h-60 scroll-py-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5"
                aria-label="Models"
              >
                {matches.map((entry) => (
                  <Combobox.Item
                    key={entry.id}
                    value={entry}
                    disabled={entry.unavailable}
                    aria-label={entry.name}
                    title={entry.name}
                    className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-xs outline-none data-highlighted:bg-accent data-selected:text-primary data-disabled:cursor-default data-disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {entry.name}
                    </span>
                    {entry.isDefault && (
                      <span className="text-[10px] text-muted-foreground">
                        Default
                      </span>
                    )}
                    {entry.unavailable && (
                      <span className="text-[10px] text-muted-foreground">
                        Unavailable
                      </span>
                    )}
                    <Combobox.ItemIndicator>
                      <Check className="size-3.5" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                ))}
              </Combobox.List>
              {catalog?.error && (
                <p className="border-t border-border/60 px-3 py-2 text-xs text-destructive">
                  {catalog.error}
                </p>
              )}
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
