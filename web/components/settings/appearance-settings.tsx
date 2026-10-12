"use client"

import { ChevronDownIcon } from "lucide-react"

import { useThemeMode } from "@/components/theme/theme-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { THEME_MODES, themeModeLabel, type ThemeMode } from "@/lib/theme"

export function AppearanceSettings() {
  const { mode, setMode } = useThemeMode()

  return (
    <section className="space-y-4">
      <div className="space-y-1 border-b border-border/70 pb-3">
        <h2 className="text-xl font-semibold tracking-tight">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          Control how Edu looks on this device.
        </p>
      </div>

      <div className="flex flex-col gap-2.5 rounded-[1.5rem] bg-background p-5 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="space-y-1">
          <Label htmlFor="theme-mode-trigger" className="font-medium">
            Theme
          </Label>
          <p className="text-sm text-muted-foreground">
            Light, dark, or match your system setting.
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            id="theme-mode-trigger"
            render={
              <Button
                variant="outline"
                className="h-10 w-full rounded-full justify-between bg-background sm:w-40"
              />
            }
          >
            {themeModeLabel(mode)}
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => {
                setMode(value as ThemeMode)
              }}
            >
              {THEME_MODES.map((option) => (
                <DropdownMenuRadioItem key={option} value={option}>
                  {themeModeLabel(option)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>
  )
}
