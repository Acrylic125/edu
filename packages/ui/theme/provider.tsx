"use client"

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  applyThemeMode,
  getSystemPrefersDark,
  readStoredThemeMode,
  resolveIsDark,
  writeStoredThemeMode,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "./utils"

const listeners = new Set<() => void>()
let mode: ThemeMode = "system"
let dark = false
let disconnect: (() => void) | undefined

function updateTheme() {
  mode = readStoredThemeMode()
  dark = resolveIsDark(mode, getSystemPrefersDark())
  applyThemeMode(mode, dark)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const storage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) updateTheme()
    }
    media.addEventListener("change", updateTheme)
    window.addEventListener("storage", storage)
    disconnect = () => {
      media.removeEventListener("change", updateTheme)
      window.removeEventListener("storage", storage)
    }
    updateTheme()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      disconnect?.()
      disconnect = undefined
    }
  }
}

function setMode(next: ThemeMode) {
  writeStoredThemeMode(next)
  mode = next
  dark = resolveIsDark(next, getSystemPrefersDark())
  applyThemeMode(next, dark)
  for (const listener of listeners) listener()
}

const ThemeContext = createContext<{
  mode: ThemeMode
  dark: boolean
  setMode: typeof setMode
} | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const currentMode = useSyncExternalStore(
    subscribe,
    () => mode,
    () => "system" as const,
  )
  const currentDark = useSyncExternalStore(
    subscribe,
    () => dark,
    () => false,
  )
  return (
    <ThemeContext.Provider
      value={{ mode: currentMode, dark: currentDark, setMode }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useThemeMode() {
  const context = useContext(ThemeContext)
  if (!context)
    throw new Error("useThemeMode must be used within ThemeProvider")
  return context
}
