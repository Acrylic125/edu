import { Suspense } from "react"

import { UsageSettings } from "@/components/settings/usage-settings"
import { loadUsage } from "@/lib/usage/load"

export default function UsagePage() {
  return (
    <Suspense fallback={<UsageLoading />}>
      <UsageData />
    </Suspense>
  )
}

async function UsageData() {
  const usage = await loadUsage()
  return <UsageSettings usage={usage} />
}

function UsageLoading() {
  return (
    <div className="space-y-3" aria-label="Loading usage" role="status">
      <div className="space-y-1 border-b border-border/70 pb-3">
        <div className="h-6 w-20 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="flex justify-end">
        <div className="h-7 w-52 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="h-16 animate-pulse rounded-lg bg-muted" />
      <div className="h-72 animate-pulse rounded-lg bg-muted" />
    </div>
  )
}
