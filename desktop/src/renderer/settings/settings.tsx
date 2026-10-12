import { useRef, useState } from "react"
import { ArrowLeft, Check, Plus, RotateCcw, X } from "lucide-react"
import { useThemeMode } from "@edu/ui/theme"
import { desktop } from "../store"
import { ProviderSettingsSchema, type Snapshot } from "../../shared/contracts"

export function DesktopSettings({ snapshot, busy, perform, onBack, error, onDismissError }: {
  snapshot: Snapshot
  busy: boolean
  perform: (operation: () => Promise<void>) => Promise<boolean>
  onBack: () => void
  error: string | null
  onDismissError: () => void
}) {
  const [section, setSection] = useState<"appearance" | "providers">("appearance")

  return (
    <main className="flex h-dvh gap-4 bg-background p-4 text-foreground" aria-label="Settings">
      <nav className="w-44 shrink-0 border-r border-border pr-4 pt-6" aria-label="Settings sections">
        <button className="mb-6 flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" /> Back
        </button>
        {(["appearance", "providers"] as const).map((item) => (
          <button key={item} aria-current={section === item ? "page" : undefined} onClick={() => setSection(item)} className={`mb-1 h-11 w-full rounded-lg px-3 text-left text-sm font-medium ${section === item ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
            {item === "appearance" ? "Appearance" : "Providers"}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto rounded-[1.75rem] bg-card">
        <div className="mx-auto max-w-4xl px-8 py-14 lg:px-16 lg:py-16">
          {error && (
            <div className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" className="shrink-0 rounded p-1" onClick={onDismissError}><X className="size-4" /></button>
            </div>
          )}
          {section === "appearance" ? <AppearanceSettings /> : <ProviderSettings snapshot={snapshot} busy={busy} perform={perform} />}
        </div>
      </div>
    </main>
  )
}

function AppearanceSettings() {
  const { mode, setMode } = useThemeMode()
  return (
    <fieldset>
      <legend className="mb-7 text-xl font-medium tracking-tight">Theme</legend>
      <div className="grid max-w-xl grid-cols-3 gap-5">
        {(["system", "light", "dark"] as const).map((option) => (
          <label key={option} className="group cursor-pointer text-center">
            <span className={`theme-preview theme-preview-${option} mb-3 block aspect-[1.25] overflow-hidden rounded-xl border-2 p-2 ${mode === option ? "border-primary" : "border-border group-hover:border-muted-foreground"}`} aria-hidden="true">
              <span className="theme-preview-window flex h-full overflow-hidden rounded-md border">
                <span className="theme-preview-sidebar flex w-1/4 flex-col gap-2 border-r p-2">
                  <span className="theme-preview-mark h-2 w-2 rounded-full" />
                  <span className="theme-preview-line h-1 w-full rounded" />
                  <span className="theme-preview-line h-1 w-3/4 rounded" />
                </span>
                <span className="flex flex-1 flex-col items-center justify-center gap-2 p-2">
                  <span className="theme-preview-line h-1.5 w-2/3 rounded" />
                  <span className="flex w-full gap-1"><span className="theme-preview-mark h-5 flex-1 rounded" /><span className="theme-preview-tile h-5 flex-1 rounded" /><span className="theme-preview-line h-5 flex-1 rounded" /></span>
                  <span className="theme-preview-input h-3 w-full rounded-full border" />
                </span>
              </span>
            </span>
            <span className="mb-3 block text-sm">{option[0].toUpperCase() + option.slice(1)}</span>
            <input type="radio" name="theme" aria-label={option[0].toUpperCase() + option.slice(1)} value={option} checked={mode === option} onChange={() => setMode(option)} className="size-4 cursor-pointer accent-primary" />
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function ProviderSettings({ snapshot, busy, perform }: {
  snapshot: Snapshot
  busy: boolean
  perform: (operation: () => Promise<void>) => Promise<boolean>
}) {
  const [selectedId, setSelectedId] = useState<Snapshot["providers"][number]["id"]>()
  const dialog = useRef<HTMLDialogElement>(null)
  const configured = snapshot.providers.filter((provider) => provider.settings || provider.connected || provider.connecting)
  const available = snapshot.providers.filter((provider) => !configured.some((item) => item.id === provider.id))
  const selected = configured.find((provider) => provider.id === selectedId) ?? configured[0]

  const addButton = (
    <button className="flex h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50" disabled={busy || available.length === 0} onClick={() => dialog.current?.showModal()}>
      <Plus className="size-4" /> Add provider
    </button>
  )

  return (
    <section aria-labelledby="providers-heading">
      <h1 id="providers-heading" className="text-xl font-medium tracking-tight">Provider</h1>
      <p className="mt-2 text-sm text-muted-foreground">Use your existing ChatGPT, Claude, Antigravity, or OpenRouter account.</p>
      {configured.length === 0 ? (
        <div className="mt-8 flex min-h-60 flex-col items-center justify-center gap-5 rounded-xl border border-border p-8">
          <div className="flex items-end gap-2 text-muted-foreground" aria-hidden="true">
            <span className="size-9 rounded-lg border border-border bg-learning-sage" /><span className="mb-4 size-9 rounded-lg border border-border bg-learning-yellow" /><span className="size-9 rounded-lg border border-border bg-learning-blue" />
          </div>
          <p className="text-sm text-muted-foreground">Choose your own provider</p>
          {addButton}
        </div>
      ) : (
        <div className="mt-9 grid gap-8 md:grid-cols-[160px_minmax(0,1fr)]">
          <div>
            <h2 className="mb-3 text-sm font-medium">Providers</h2>
            {addButton}
            <div className="mt-3 space-y-1" aria-label="Your providers">
              {configured.map((provider) => (
                <button key={provider.id} aria-pressed={selected?.id === provider.id} onClick={() => setSelectedId(provider.id)} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm ${selected?.id === provider.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-xs font-semibold" aria-hidden="true">{provider.name[0]}</span>
                  <span className="break-words">{provider.settings?.displayName ?? (provider.id === "codex" ? "ChatGPT" : provider.name)}</span>
                </button>
              ))}
            </div>
          </div>
          {selected && <ProviderEditor key={selected.id} provider={selected} busy={busy} perform={perform} />}
        </div>
      )}
      <dialog ref={dialog} className="m-auto w-[min(400px,calc(100vw-48px))] rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-xl backdrop:bg-black/50">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add provider</h2>
          <button aria-label="Close add provider" className="rounded-full p-1 text-muted-foreground hover:bg-accent" onClick={() => dialog.current?.close()}><X className="size-4" /></button>
        </div>
        <div className="space-y-2">
          {available.map((provider) => {
            let description = "Use your signed-in local CLI"
            if (provider.id === "codex") description = "Sign in with your ChatGPT account"
            else if (provider.id === "openrouter") description = "Connect your OpenRouter account"
            return (
              <button key={provider.id} disabled={busy} className="block w-full rounded-xl border border-border p-4 text-left hover:bg-accent disabled:opacity-50" onClick={() => {
                void perform(async () => {
                  await desktop().saveProvider({ id: provider.id, displayName: provider.id === "codex" ? "ChatGPT" : provider.name })
                  setSelectedId(provider.id)
                  dialog.current?.close()
                })
              }}>
                <span className="block text-sm font-medium">{provider.id === "codex" ? "ChatGPT" : provider.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
              </button>
            )
          })}
        </div>
      </dialog>
    </section>
  )
}

function ProviderEditor({ provider, busy, perform }: {
  provider: Snapshot["providers"][number]
  busy: boolean
  perform: (operation: () => Promise<void>) => Promise<boolean>
}) {
  const [displayName, setDisplayName] = useState(provider.settings?.displayName ?? (provider.id === "codex" ? "ChatGPT" : provider.name))
  const [binaryPath, setBinaryPath] = useState(provider.settings?.binaryPath ?? "")
  const [saved, setSaved] = useState(false)
  let actionLabel = "Connect account"
  if (provider.id === "codex") actionLabel = "Sign in with ChatGPT"
  if (provider.id === "claude" || provider.id === "antigravity") actionLabel = "Check connection"
  if (provider.connected) actionLabel = "Disconnect"
  const cliProvider = provider.id === "claude" || provider.id === "antigravity"
  if (provider.connecting) {
    actionLabel = "Cancel sign-in"
    if (cliProvider) actionLabel = "Checking connection…"
  }
  let binaryPlaceholder = "Bundled Codex runtime"
  let binaryHelp = "Leave the binary path empty to use the bundled runtime."
  if (provider.id === "openrouter") {
    binaryPlaceholder = "Not required"
    binaryHelp = "OpenRouter connects directly to your account."
  } else if (cliProvider) {
    binaryPlaceholder = "/absolute/path/to/agy"
    if (provider.id === "claude") binaryPlaceholder = "/absolute/path/to/claude"
    binaryHelp = "Set and save the absolute path to your installed CLI. Text and extracted PDF text are supported."
  }

  return (
    <form onSubmit={(event) => {
      event.preventDefault()
      const input = ProviderSettingsSchema.parse({ id: provider.id, displayName, binaryPath })
      void perform(() => desktop().saveProvider(input)).then(setSaved)
    }}>
      <div className="grid items-center gap-x-5 gap-y-4 lg:grid-cols-[110px_minmax(0,1fr)]">
        <label htmlFor="provider-display-name" className="text-sm">Display name</label>
        <input id="provider-display-name" className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm" value={displayName} disabled={busy} required maxLength={60} onChange={(event) => { setDisplayName(event.target.value); setSaved(false) }} />
        <label htmlFor="provider-binary-path" className="text-sm">Binary path</label>
        <input id="provider-binary-path" className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm disabled:text-muted-foreground" value={binaryPath} disabled={busy || provider.id === "openrouter"} placeholder={binaryPlaceholder} maxLength={4096} onChange={(event) => { setBinaryPath(event.target.value); setSaved(false) }} />
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{binaryHelp}</p>
      <div className="mt-5 flex items-center gap-3">
        <button type="submit" className="h-9 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50" disabled={busy || !displayName.trim()}>Save changes</button>
        {saved && <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status"><Check className="size-3.5" /> Saved</span>}
      </div>
      <div className="mt-8 border-t border-border pt-5">
        {provider.id === "claude" && <p className="mb-3 text-sm leading-6 text-muted-foreground">Sign in once in Terminal with <code>claude auth login</code>, then check the connection here. Disconnect only disables this provider in EdU.</p>}
        {provider.id === "antigravity" && <p className="mb-3 text-sm leading-6 text-muted-foreground">Sign in once by running <code>agy</code> in Terminal, then check the connection here. The check sends a small model request. Disconnect only disables this provider in EdU.</p>}
        <p className="mb-3 text-sm text-muted-foreground">{provider.connected ? (provider.account ?? "Connected") : "Connect your account to start learning."}</p>
        <div className="flex items-center gap-3">
          <button type="button" disabled={busy && (!provider.connecting || cliProvider)} className="min-h-9 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50" onClick={() => {
            void perform(async () => {
              if (provider.connecting) await desktop().cancelConnection(provider.id)
              else if (provider.connected) await desktop().disconnect(provider.id)
              else await desktop().connect(provider.id)
            })
          }}>{actionLabel}</button>
          <button type="button" aria-label="Refresh providers" disabled={busy || provider.loading} className="rounded-full p-2 text-muted-foreground hover:bg-accent disabled:opacity-50" onClick={() => { void perform(() => desktop().refreshProviders()) }}><RotateCcw className={`size-4 ${provider.loading ? "animate-spin motion-reduce:animate-none" : ""}`} /></button>
        </div>
        {provider.error && <p className="mt-3 text-sm text-destructive" role="alert">{provider.error}</p>}
      </div>
    </form>
  )
}
