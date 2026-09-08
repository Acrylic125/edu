import { UsageChart } from "@/components/settings/usage-chart"
import type { UsagePayload } from "@/lib/usage/schema"

export function UsageSettings({ usage }: { usage: UsagePayload }) {
  return (
    <section className="space-y-4">
      <div className="space-y-1 border-b border-border/70 pb-3">
        <h2 className="text-xl font-semibold tracking-tight">Usage</h2>
        <p className="text-sm text-muted-foreground">
          Your plan allowances and learning activity.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium">{usage.subscription.name} plan</h3>
          <span className="text-xs text-muted-foreground">
            Up to {usage.subscription.aiRequestsPerMinute} AI requests per minute
          </span>
        </div>
        <dl className="divide-y divide-border text-sm">
          {usage.subscription.allowances.map((allowance) => (
            <div key={allowance.metric} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
              <dt>{allowanceLabels[allowance.metric]}</dt>
              <dd className="text-right tabular-nums">
                {formatAmount(allowance.used, allowance.metric)} / {formatAmount(allowance.limit, allowance.metric)}
                <span className="block text-xs text-muted-foreground">
                  {formatAmount(allowance.remaining, allowance.metric)} remaining
                  {allowance.resetAt && ` · Resets ${new Date(allowance.resetAt).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" })}, 00:00 UTC`}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs leading-relaxed text-muted-foreground">
          One accepted message uses one AI request. Internal model calls are included; confirming or rejecting a plan is free.
          Failed requests without a useful result are refunded; stopping a running request still counts.
          Uploads reserve space for one hour. PDF pages count once when accepted for indexing.
        </p>
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Learning activity</h3>
        <p className="text-xs text-muted-foreground">Saved messages and responses; these counts can differ from AI requests.</p>
      </div>
      <UsageChart usage={usage} />
    </section>
  )
}

const allowanceLabels = {
  aiRequestsPerDay: "AI requests today",
  aiRequestsPerMonth: "AI requests this month",
  uploadsPerMonth: "File uploads this month",
  pdfPagesPerMonth: "PDF pages this month",
  storageBytes: "Attachment storage",
}

function formatAmount(value: number, metric: keyof typeof allowanceLabels) {
  if (metric === "storageBytes") {
    return `${(value / (1024 * 1024)).toLocaleString("en-GB", { maximumFractionDigits: 1 })} MiB`
  }
  return value.toLocaleString("en-GB")
}
