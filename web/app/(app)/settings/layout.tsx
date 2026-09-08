import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { SettingsNav } from "@/components/settings/settings-nav"
import { AccountMenu } from "@/components/ui/account-menu"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="h-12 border-b border-border px-3">
        <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
            Settings
          </h1>
          <AccountMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-2 sm:py-3 md:px-0">
        <div className="grid gap-4 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-6">
          <aside className="space-y-1">
            <Link
              href="/chat"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "h-7 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
              )}
            >
              <ArrowLeft />
              Back
            </Link>
            <SettingsNav />
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </main>
    </div>
  )
}
