export type ThemeMode = "light" | "dark" | "system"

export const THEME_STORAGE_KEY = "edu-theme"

export function isThemeMode(
  value: string | null | undefined,
): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system"
}

export function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "system"
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeMode(stored) ? stored : "system"
  } catch {
    return "system"
  }
}

export function writeStoredThemeMode(mode: ThemeMode): void {
  if (typeof window === "undefined") {
    return
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function resolveIsDark(
  mode: ThemeMode,
  systemPrefersDark = getSystemPrefersDark(),
): boolean {
  if (mode === "system") {
    return systemPrefersDark
  }
  return mode === "dark"
}

/** Same approach t3code uses: toggle the `dark` class on <html>. */
export function applyThemeMode(
  mode: ThemeMode,
  systemPrefersDark = getSystemPrefersDark(),
): void {
  if (typeof document === "undefined") {
    return
  }
  document.documentElement.classList.toggle(
    "dark",
    resolveIsDark(mode, systemPrefersDark),
  )
}
