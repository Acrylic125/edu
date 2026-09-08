"use client"

import { useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import type { UsagePayload } from "@/lib/usage/schema"

const PERIODS = [
  { value: "1d", label: "1d", detail: "Hourly" },
  { value: "7d", label: "7d", detail: "Daily" },
  { value: "1mo", label: "1mo", detail: "Daily" },
  { value: "mtd", label: "MTD", detail: "Daily" },
  { value: "ytd", label: "YTD", detail: "Monthly" },
] as const

type Period = (typeof PERIODS)[number]["value"]

const chartConfig = {
  credits: {
    label: "Credits",
    theme: {
      light: "oklch(0.55 0.22 275)",
      dark: "oklch(0.72 0.18 275)",
    },
  },
} satisfies ChartConfig

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
})

const hourFormatter = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
})

const weekdayFormatter = new Intl.DateTimeFormat("en", {
  weekday: "short",
  timeZone: "UTC",
})

const dayFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  timeZone: "UTC",
})

const monthFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  timeZone: "UTC",
})

function formatBucketLabel(timestamp: string, period: Period) {
  const date = new Date(timestamp)
  if (period === "1d") {
    return hourFormatter.format(date)
  }
  if (period === "7d") {
    return weekdayFormatter.format(date)
  }
  if (period === "ytd") {
    return monthFormatter.format(date)
  }
  return dayFormatter.format(date)
}

export function UsageChart({ usage }: { usage: UsagePayload }) {
  const [period, setPeriod] = useState<Period>("7d")
  const selectedPeriod = usage.periods[period]
  const data = selectedPeriod.buckets.map((bucket) => ({
    ...bucket,
    label: formatBucketLabel(bucket.timestamp, period),
  }))
  const credits = data.reduce((total, item) => total + item.credits, 0)
  const detail = PERIODS.find((option) => option.value === period)?.detail

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div
          role="group"
          aria-label="Usage period"
          className="grid grid-cols-5 rounded-md bg-muted p-0.5"
        >
          {PERIODS.map((option) => {
            const isActive = option.value === period

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setPeriod(option.value)}
                aria-pressed={isActive}
                title={`${option.label}, ${option.detail.toLowerCase()} breakdown`}
                className={cn(
                  "h-7 min-w-10 rounded-[calc(var(--radius-md)-2px)] px-1.5 text-xs font-semibold text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  isActive && "bg-background text-foreground shadow-xs"
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-xs">
        <div className="flex flex-col items-start justify-between gap-2 border-b border-border/70 px-4 py-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-medium">Credits used</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {detail} breakdown
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xl font-semibold tracking-tight tabular-nums">{credits.toLocaleString("en-GB")}</p>
            <p className="text-xs text-muted-foreground">Total in period</p>
          </div>
        </div>

        <div className="px-2 py-3 sm:px-3 sm:py-4">
          <ChartContainer
            config={chartConfig}
            className="h-60 w-full aspect-auto sm:h-64"
          >
            <BarChart
              data={data}
              margin={{ top: 6, right: 8, left: -12, bottom: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => compactNumber.format(value)}
                width={52}
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", opacity: 0.45 }}
                content={<ChartTooltipContent indicator="dot" />}
              />
              <Bar
                dataKey="credits"
                fill="var(--color-credits)"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </div>
      </div>
    </div>
  )
}
