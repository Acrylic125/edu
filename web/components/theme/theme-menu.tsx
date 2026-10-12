"use client"

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { useThemeMode } from "@/components/theme/theme-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { isThemeMode, THEME_MODES, themeModeLabel } from "@/lib/theme"

export function ThemeMenu() {
  const { mode, dark, setMode } = useThemeMode()
  let Icon = SunIcon
  if (dark) {
    Icon = MoonIcon
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Change appearance"
        render={<Button variant="ghost" size="icon" className="size-10 rounded-full bg-card text-foreground motion-reduce:transition-none" />}
      >
        <Icon className="size-4.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40 p-2">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            if (isThemeMode(value)) {
              setMode(value)
            }
          }}
        >
          {THEME_MODES.map((option) => {
            let OptionIcon = MonitorIcon
            if (option === "light") {
              OptionIcon = SunIcon
            } else if (option === "dark") {
              OptionIcon = MoonIcon
            }
            return (
              <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                <OptionIcon className="size-4" />
                {themeModeLabel(option)}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
