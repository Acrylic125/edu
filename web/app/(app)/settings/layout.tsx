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
      <header className="h-20 px-5">
        <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">
            Settings
          </h1>
          <AccountMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 pb-10 pt-4 sm:pt-6">
        <div className="grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-8">
          <aside className="space-y-4">
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
          <div className="min-w-0 rounded-[2rem] bg-card p-6 sm:p-8">{children}</div>
        </div>
      </main>
    </div>
  )
}
