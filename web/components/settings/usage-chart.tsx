"use client"

import { useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

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
  requests: {
    label: "Requests",
    theme: {
      light: "oklch(0.55 0.22 275)",
      dark: "oklch(0.72 0.18 275)",
    },
  },
  responses: {
    label: "Responses",
    theme: {
      light: "oklch(0.68 0.16 65)",
      dark: "oklch(0.79 0.14 70)",
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
  const requests = data.reduce((total, item) => total + item.requests, 0)
  const responses = data.reduce((total, item) => total + item.responses, 0)
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

      <div className="grid gap-px overflow-hidden rounded-lg border border-border/70 bg-border/70 sm:grid-cols-2">
        <Metric
          label="Requests"
          value={requests}
          color="bg-violet-600 dark:bg-violet-400"
        />
        <Metric
          label="Responses"
          value={responses}
          color="bg-amber-600 dark:bg-amber-400"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-xs">
        <div className="flex flex-col items-start justify-between gap-2 border-b border-border/70 px-4 py-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-medium">Requests and responses</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {detail} breakdown
            </p>
          </div>
          <div
            className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground"
            aria-hidden="true"
          >
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-violet-600 dark:bg-violet-400" />
              Requests
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-amber-600 dark:bg-amber-400" />
              Responses
            </span>
          </div>
        </div>

        <div className="px-2 py-3 sm:px-3 sm:py-4">
          <ChartContainer
            config={chartConfig}
            className="h-60 w-full aspect-auto sm:h-64"
          >
            <AreaChart
              data={data}
              margin={{ top: 6, right: 8, left: -12, bottom: 0 }}
            >
              <defs>
                <linearGradient id="requestsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-requests)" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="var(--color-requests)" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="responsesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-responses)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--color-responses)" stopOpacity={0.01} />
                </linearGradient>
              </defs>
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
                cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }}
                content={<ChartTooltipContent indicator="line" />}
              />
              <Area
                dataKey="responses"
                type="monotone"
                fill="url(#responsesFill)"
                stroke="var(--color-responses)"
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Area
                dataKey="requests"
                type="monotone"
                fill="url(#requestsFill)"
                stroke="var(--color-requests)"
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        </div>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={cn("size-2 rounded-full", color)}
          aria-hidden="true"
        />
        {label}
      </div>
      <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
        {value.toLocaleString()}
      </p>
    </div>
  )
}
