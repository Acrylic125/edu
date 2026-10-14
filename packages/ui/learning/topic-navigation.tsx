"use client"

import type { ReactNode } from "react"
import { useRender } from "@base-ui/react/use-render"
import { LoaderCircleIcon } from "lucide-react"

import { cn } from "../utils"

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
  render,
  className,
  ...props
}: Omit<useRender.ComponentProps<"button">, "children"> & {
  selected?: boolean
  busy?: boolean
  title: string
}) {
  return useRender({
    defaultTagName: "button",
    render,
    props: {
      ...props,
      "aria-current": selected ? "page" : undefined,
      className: cn(
        "flex min-h-11 w-full items-center gap-2.5 rounded-2xl px-3 py-3 text-left text-sm leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
        className,
      ),
      children: (
        <>
          <span className="line-clamp-2 flex-1">{title}</span>
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
