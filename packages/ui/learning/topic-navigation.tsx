"use client"

import type { ReactNode } from "react"
import { useRender } from "@base-ui/react/use-render"
import { LoaderCircleIcon } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"
import { Badge } from "../primitives/badge"

import { cn } from "../utils"

const statusVariants = cva("", {
  variants: {
    status: {
      staging: "bg-amber-500/8 text-sidebar-foreground hover:bg-amber-500/14",
      error: "bg-destructive/8 text-sidebar-foreground hover:bg-destructive/14",
    },
    selected: { true: "", false: "" },
  },
  compoundVariants: [
    { status: "staging", selected: true, className: "bg-amber-500/16 hover:bg-amber-500/20" },
    { status: "error", selected: true, className: "bg-destructive/16 hover:bg-destructive/20" },
  ],
})

export function TopicNavigation({
  children,
  empty,
  label = "Your topics",
}: {
  children: ReactNode
  empty: boolean
  label?: string
}) {
  return (
    <>
      <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">
        {label}
      </p>
      {empty ? (
        <p className="px-3 pt-2 text-xs leading-5 text-muted-foreground">
          Your learning plans will live here. Start with something you’re
          curious about.
        </p>
      ) : null}
      <nav className="space-y-1.5" aria-label={label}>
        {children}
      </nav>
    </>
  )
}

export function TopicNavigationItem({
  title,
  selected = false,
  busy = false,
  scratchpadType,
  status,
  render,
  className,
  ...props
}: Omit<useRender.ComponentProps<"button">, "children"> & {
  selected?: boolean
  busy?: boolean
  scratchpadType?: "topic" | "test" | "generic"
  title: string
} & VariantProps<typeof statusVariants>) {
  return useRender({
    defaultTagName: "button",
    render,
    props: {
      ...props,
      "aria-current": selected ? "page" : undefined,
      className: cn(
        "flex min-h-11 w-full items-center gap-2.5 rounded-2xl px-3 py-3 text-left text-sm font-medium leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
        !status && selected && scratchpadType === "topic" && "bg-learning-yellow text-learning-ink",
        !status && selected && scratchpadType === "test" && "bg-learning-sage text-learning-ink",
        !status && selected && scratchpadType === "generic" && "bg-learning-blue text-learning-ink",
        statusVariants({ status, selected }),
        className,
      ),
      children: (
        <>
          <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
            <span className="line-clamp-2">{title}</span>
            {status === "staging" && (
              <Badge variant="outline" className="border-amber-700/15 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-800 dark:border-amber-300/15 dark:text-amber-200">Staging</Badge>
            )}
            {status === "error" && (
              <Badge variant="outline" className="border-destructive/20 bg-destructive/10 px-1.5 py-0 text-[10px] text-destructive">Error</Badge>
            )}
          </span>
          {busy ? (
            <LoaderCircleIcon
              className="size-3.5 shrink-0 animate-spin"
              aria-label="Runner working"
            />
          ) : null}
        </>
      ),
    },
  })
}
