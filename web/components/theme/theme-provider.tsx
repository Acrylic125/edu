"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import {
  applyThemeMode,
  getSystemPrefersDark,
  readStoredThemeMode,
  writeStoredThemeMode,
  type ThemeMode,
} from "@/lib/theme"

type ThemeContextValue = {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system")

  useEffect(() => {
    const stored = readStoredThemeMode()
    setModeState(stored)
    applyThemeMode(stored)
  }, [])

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      if (readStoredThemeMode() === "system") {
        applyThemeMode("system", media.matches)
      }
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    writeStoredThemeMode(next)
    applyThemeMode(next, getSystemPrefersDark())
  }, [])

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useThemeMode(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useThemeMode must be used within ThemeProvider")
  }
  return context
}
