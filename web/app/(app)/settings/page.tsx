import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { AppearanceSettings } from "@/components/settings/appearance-settings"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default function SettingsPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-12 w-full max-w-3xl items-center gap-2 px-4">
          <Link
            href="/"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1.5")}
          >
            <ArrowLeft />
            Back
          </Link>
          <h1 className="text-sm font-medium">Settings</h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <AppearanceSettings />
      </main>
    </div>
  )
}
