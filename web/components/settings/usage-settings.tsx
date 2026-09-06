import { UsageChart } from "@/components/settings/usage-chart"
import type { UsagePayload } from "@/lib/usage/schema"

export function UsageSettings({ usage }: { usage: UsagePayload }) {
  return (
    <section className="space-y-4">
      <div className="space-y-1 border-b border-border/70 pb-3">
        <h2 className="text-xl font-semibold tracking-tight">Usage</h2>
        <p className="text-sm text-muted-foreground">
          Requests and responses from your learning sessions.
        </p>
      </div>

      <UsageChart usage={usage} />
    </section>
  )
}
