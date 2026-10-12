"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChartNoAxesCombined, SlidersHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"

const SETTINGS_LINKS = [
  { href: "/settings", label: "General", icon: SlidersHorizontal },
  { href: "/settings/usage", label: "Usage", icon: ChartNoAxesCombined },
] as const

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Settings sections"
      className="flex gap-1 overflow-x-auto border-b border-border/70 pb-1.5 md:block md:overflow-visible md:border-b-0 md:pb-0"
    >
      {SETTINGS_LINKS.map((item) => {
        const Icon = item.icon
        const isActive = pathname === item.href

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-11 min-w-24 items-center gap-2 rounded-full px-4 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:mb-0.5 md:w-full",
              isActive
                ? "bg-learning-yellow text-learning-ink"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
