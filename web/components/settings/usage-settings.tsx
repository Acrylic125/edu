import { UsageChart } from "@/components/settings/usage-chart"
import type { UsagePayload } from "@/lib/usage/schema"

export function UsageSettings({ usage }: { usage: UsagePayload }) {
  return (
    <section className="space-y-4">
      <div className="space-y-1 border-b border-border/70 pb-3">
        <h2 className="text-xl font-semibold tracking-tight">Usage</h2>
        <p className="text-sm text-muted-foreground">
          Your plan allowances and credit activity.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium">{usage.subscription.name} plan</h3>
          <span className="text-xs text-muted-foreground">Credits renew automatically</span>
        </div>
        <dl className="grid gap-2 sm:grid-cols-2">
          {usage.subscription.allowances.map((allowance) => (
            <div key={allowance.metric} className="rounded-md border border-border/70 bg-muted/25 p-3">
              <dt className="text-xs text-muted-foreground">{allowanceLabels[allowance.metric]}</dt>
              <dd className="mt-1 tabular-nums">
                <span className="text-xl font-semibold tracking-tight">{allowance.used.toLocaleString("en-GB")}</span>
                <span className="text-sm text-muted-foreground"> / {allowance.limit.toLocaleString("en-GB")}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {allowance.remaining.toLocaleString("en-GB")} remaining
                  {allowance.resetAt && ` · Resets ${formatReset(allowance.resetAt)}`}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Each turn costs 1 credit, including tool calls and image processing. Image uploads cost 1 additional credit;
          PDF uploads cost 1 additional credit per indexed page. Failed turns without a useful result are refunded.
        </p>
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Credit usage</h3>
        <p className="text-xs text-muted-foreground">Turns and uploaded content charged to your plan.</p>
      </div>
      <UsageChart usage={usage} />
    </section>
  )
}

const allowanceLabels = {
  creditsPer5Hours: "Current 5-hour window",
  creditsPerWeek: "This week",
}

function formatReset(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }) + " UTC"
}
