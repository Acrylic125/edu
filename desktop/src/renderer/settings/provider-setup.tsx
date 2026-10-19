import { Check, Circle, LoaderCircle, RotateCcw } from "lucide-react"
import type { Snapshot } from "../../shared/contracts"

export function ProviderSetupInstructions({ provider, onRefresh, disabled = false }: {
  provider: Snapshot["providers"][number]
  onRefresh: () => void
  disabled?: boolean
}) {
  const installed = provider.installed
  let installUrl = "https://code.claude.com/docs/en/setup"
  if (provider.id === "codex") installUrl = "https://developers.openai.com/codex/cli"
  if (provider.id === "antigravity") installUrl = "https://antigravity.google/docs/cli/install"

  return (
    <ol className="mt-3 list-decimal space-y-3 pl-4 leading-5 text-muted-foreground">
      <li>
        <div className="flex items-start justify-between gap-3">
          <span>
            <a href={installUrl} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-2">Install CLI</a>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <button type="button" aria-label={`Recheck ${provider.name} setup`} title="Recheck setup" disabled={disabled || provider.loading || provider.connecting} onClick={onRefresh} className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
              <RotateCcw aria-hidden="true" className={`size-3.5 ${provider.loading ? "animate-spin motion-reduce:animate-none" : ""}`} />
            </button>
            {installed ? (
              <Check role="img" aria-label="Installation complete" className="size-4 text-emerald-500" />
            ) : (
              <Circle role="img" aria-label="Installation incomplete" className="size-4 text-muted-foreground/40" />
            )}
          </span>
        </div>
      </li>
      <li>
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 break-words">
            Connect account
            {provider.connected && provider.account && <> (Signed in as {provider.account})</>}
          </span>
          {provider.connected && <Check role="img" aria-label="Account connected" className="size-4 shrink-0 text-emerald-500" />}
          {!provider.connected && provider.connecting && <LoaderCircle role="img" aria-label="Connecting account" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />}
          {!provider.connected && !provider.connecting && <Circle role="img" aria-label="Account not connected" className="size-4 shrink-0 text-muted-foreground/40" />}
        </div>
      </li>
    </ol>
  )
}
