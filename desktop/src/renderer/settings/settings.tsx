import { useRef, useState } from "react"
import { ArrowLeft, Check, Plus, Settings, X } from "lucide-react"
import { useThemeMode } from "@edu/ui/theme"
import { WorkspaceFrame, WorkspaceSidebar, useWorkspaceLayout } from "@edu/ui/workspace"
import { desktop, desktopErrorMessage } from "../store"
import { ProviderSetupInstructions } from "./provider-setup"
import { ProviderIcon } from "../provider-icon"
import appIcon from "../assets/app-icon.png"
import { ProviderSettingsSchema, type Snapshot } from "../../shared/contracts"

export function DesktopSettings({ snapshot, onBack, initialProvider }: {
  initialProvider?: Snapshot["providers"][number]["id"]
  snapshot: Snapshot
  onBack: () => void
}) {
  const [section, setSection] = useState<"appearance" | "providers">(initialProvider ? "providers" : "appearance")

  return (
    <WorkspaceFrame
      title="Settings"
      appName="EdU"
      nativeTitlebar={navigator.userAgent.includes("Macintosh")}
      navigationName="settings"
      sidebar={<SettingsSidebar section={section} onSection={setSection} onBack={onBack} />}
    >
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-card md:rounded-[1.75rem]" aria-label="Settings">
        <div className="mx-auto max-w-4xl px-8 py-14 lg:px-16 lg:py-16">
          {section === "appearance" ? <AppearanceSettings /> : <ProviderSettings initialProvider={initialProvider} snapshot={snapshot} />}
        </div>
      </main>
    </WorkspaceFrame>
  )
}

function SettingsSidebar({
  section,
  onSection,
  onBack,
}: {
  section: "appearance" | "providers"
  onSection: (section: "appearance" | "providers") => void
  onBack: () => void
}) {
  const { closeNavigation } = useWorkspaceLayout()
  const sections = [
    { id: "appearance", label: "Appearance" },
    { id: "providers", label: "Providers" },
  ] as const

  return (
    <WorkspaceSidebar
      label="Settings"
      brand={
        <button
          onClick={() => {
            closeNavigation()
            onBack()
          }}
          className="flex items-center gap-3 rounded-xl text-left text-xl font-semibold tracking-tight"
        >
          <img src={appIcon} alt="" className="size-11 shrink-0 object-contain" />
          EdU
        </button>
      }
      footer={
        <button
          className="ml-auto rounded-full bg-sidebar-accent p-2 text-sidebar-accent-foreground"
          aria-label="Settings"
          aria-current="page"
          title="Settings"
        >
          <Settings className="size-5" />
        </button>
      }
    >
      <nav className="space-y-1.5" aria-label="Settings sections">
        <button
          className="mb-6 flex min-h-11 w-full items-center gap-2.5 rounded-2xl px-3 text-left text-sm text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
          onClick={() => {
            closeNavigation()
            onBack()
          }}
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          Back
        </button>
        {sections.map((item) => (
          <button
            key={item.id}
            aria-current={section === item.id ? "page" : undefined}
            onClick={() => onSection(item.id)}
            className={`flex min-h-11 w-full items-center rounded-2xl px-3 py-3 text-left text-sm leading-snug ${section === item.id ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"}`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </WorkspaceSidebar>
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

function ProviderSettings({ snapshot, initialProvider }: {
  initialProvider?: Snapshot["providers"][number]["id"]
  snapshot: Snapshot
}) {
  const [selectedId, setSelectedId] = useState<Snapshot["providers"][number]["id"] | undefined>(initialProvider)
  const dialog = useRef<HTMLDialogElement>(null)
  const configured = snapshot.providers.filter((provider) => provider.settings || provider.connected || provider.connecting || provider.id === selectedId)
  const available = snapshot.providers.filter((provider) => !configured.some((item) => item.id === provider.id))
  const selected = configured.find((provider) => provider.id === selectedId) ?? configured[0]

  const addButton = (
    <button className="flex h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50" disabled={available.length === 0} onClick={() => dialog.current?.showModal()}>
      <Plus className="size-4" /> Add provider
    </button>
  )

  return (
    <section aria-labelledby="providers-heading">
      <h1 id="providers-heading" className="text-xl font-medium tracking-tight">Provider</h1>
      <p className="mt-2 text-sm text-muted-foreground">Use your existing ChatGPT, Claude, Antigravity, or OpenRouter account.</p>
      <p className="mt-2 text-xs text-muted-foreground">All providers are checked every 5 minutes.</p>
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
                <button key={provider.id} aria-pressed={selected?.id === provider.id} aria-description={provider.connected ? "Connected" : "Setup incomplete"} onClick={() => setSelectedId(provider.id)} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm ${selected?.id === provider.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                  <span className="flex size-7 shrink-0 items-center justify-center" aria-hidden="true">
                    <ProviderIcon provider={provider.id} className="size-5 object-contain" />
                  </span>
                  <span className="min-w-0 flex-1 break-words">{provider.settings?.displayName ?? (provider.id === "codex" ? "ChatGPT" : provider.name)}</span>
                  {provider.connected && <Check aria-hidden="true" className="size-4 shrink-0 text-emerald-500" />}
                </button>
              ))}
            </div>
          </div>
          {selected && <ProviderEditor key={selected.id} provider={selected} />}
        </div>
      )}
      <dialog ref={dialog} className="m-auto w-[min(400px,calc(100vw-48px))] rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-xl backdrop:bg-black/50">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add provider</h2>
          <button aria-label="Close add provider" className="rounded-full p-1 text-muted-foreground hover:bg-accent" onClick={() => dialog.current?.close()}><X className="size-4" /></button>
        </div>
        <div className="space-y-2">
          {available.map((provider) => {
            let description = "Install the CLI if needed, then connect"
            if (provider.id === "codex") description = "Sign in with your ChatGPT account"
            else if (provider.id === "openrouter") description = "Connect your OpenRouter account"
            return (
              <button key={provider.id} className="block w-full rounded-xl border border-border p-4 text-left hover:bg-accent disabled:opacity-50" onClick={() => {
                setSelectedId(provider.id)
                dialog.current?.close()
              }}>
                <span className="flex items-center gap-2 text-sm font-medium">
                  <ProviderIcon provider={provider.id} className="size-5 shrink-0 object-contain" />
                  {provider.id === "codex" ? "ChatGPT" : provider.name}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
              </button>
            )
          })}
        </div>
      </dialog>
    </section>
  )
}

function ProviderEditor({ provider }: {
  provider: Snapshot["providers"][number]
}) {
  const [displayNameDraft, setDisplayNameDraft] = useState<string>()
  const [binaryPathDraft, setBinaryPathDraft] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [connectionError, setConnectionError] = useState<string>()
  const displayName = displayNameDraft ?? provider.settings?.displayName ?? (provider.id === "codex" ? "ChatGPT" : provider.name)
  const binaryPath = binaryPathDraft ?? provider.settings?.binaryPath ?? ""
  const cliProvider = provider.id === "claude" || provider.id === "antigravity"
  let actionLabel = "Connect"
  if (provider.connected) actionLabel = "Disconnect"
  if (provider.connecting) {
    actionLabel = "Cancel sign-in"
    if (cliProvider) actionLabel = "Connecting…"
  }
  let binaryPlaceholder = "Bundled Codex runtime"
  let binaryHelp = "Leave the binary path empty to use the bundled runtime."
  if (provider.id === "openrouter") {
    binaryPlaceholder = "Not required"
    binaryHelp = "OpenRouter connects directly to your account."
  } else if (cliProvider) {
    binaryPlaceholder = "/absolute/path/to/agy"
    if (provider.id === "claude") binaryPlaceholder = "/absolute/path/to/claude"
    binaryHelp = "Leave empty to detect your installed CLI automatically. Set a path only for a custom installation."
  }

  async function perform(scope: "save" | "connection", operation: () => Promise<void>) {
    setBusy(true)
    if (scope === "save") {
      setSaveError(undefined)
      setSaved(false)
    } else {
      setConnectionError(undefined)
    }
    try {
      await operation()
      return true
    } catch (error) {
      let message = "This action failed. Try again."
      if (error instanceof Error) message = desktopErrorMessage(error)
      if (scope === "save") setSaveError(message)
      else setConnectionError(message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <section aria-label={`${provider.name} connection`} className="text-sm">
        <h2 className="font-medium">Setup</h2>
        <ProviderSetupInstructions provider={provider} disabled={busy} onRefresh={() => {
          void perform("connection", () => desktop().refreshProviders(provider.id))
        }} />
        <div className="mt-5 flex items-center gap-3">
          <button type="button" disabled={(cliProvider && provider.connecting) || (busy && !provider.connecting)} className="min-h-9 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50" onClick={() => {
            void perform("connection", async () => {
              if (provider.connecting) await desktop().cancelConnection(provider.id)
              else if (provider.connected) await desktop().disconnect(provider.id)
              else await desktop().connect(provider.id)
            })
          }}>{actionLabel}</button>

        </div>
        {/* Reserve feedback space so failures do not move the page or its controls. */}
        <div className="mt-3 h-20 overflow-y-auto">
          {(connectionError || provider.error) && <p role="alert" className="text-sm leading-5 text-destructive">{connectionError ?? provider.error}</p>}
        </div>
      </section>
      <details className="mt-5 border-t border-border pt-5">
        <summary className="w-fit cursor-pointer text-sm font-medium">Advanced settings</summary>
        <form aria-label={`${provider.name} settings`} className="mt-5" onSubmit={(event) => {
          event.preventDefault()
          void perform("save", async () => {
            const input = ProviderSettingsSchema.parse({ id: provider.id, displayName, binaryPath })
            await desktop().saveProvider(input)
          }).then((success) => {
            setSaved(success)
            if (success) {
              setDisplayNameDraft(undefined)
              setBinaryPathDraft(undefined)
            }
          })
        }}>
          <div className="grid items-center gap-x-5 gap-y-4 lg:grid-cols-[110px_minmax(0,1fr)]">
            <label htmlFor="provider-display-name" className="text-sm">Display name</label>
            <input id="provider-display-name" className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm" value={displayName} disabled={busy} required maxLength={60} onChange={(event) => { setDisplayNameDraft(event.target.value); setSaved(false); setSaveError(undefined) }} />
            <label htmlFor="provider-binary-path" className="text-sm">Binary path</label>
            <input id="provider-binary-path" className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm disabled:text-muted-foreground" value={binaryPath} disabled={busy || provider.id === "openrouter"} placeholder={binaryPlaceholder} maxLength={4096} onChange={(event) => { setBinaryPathDraft(event.target.value); setSaved(false); setSaveError(undefined) }} />
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{binaryHelp}</p>
          <button type="submit" className="mt-5 h-9 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50" disabled={busy || !displayName.trim()}>Save changes</button>
          <div className="mt-3 h-16 overflow-y-auto">
            {saved && <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status"><Check className="size-3.5" /> Saved</span>}
            {saveError && <p role="alert" className="text-sm leading-5 text-destructive">{saveError}</p>}
          </div>
        </form>
      </details>
    </div>
  )
}
