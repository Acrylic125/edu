import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { AppUpdateControl, useAppUpdates } from "../../src/renderer/app-updates"

export async function testAppUpdates(root: Root, host: HTMLElement) {
  const original = window.edu
  let checks = 0
  const downloads: string[] = []
  window.edu = {
    ...original!,
    checkAppUpdate: async () => {
      checks++
      return useAppUpdates.getState().update
    },
    installAppUpdate: async () => {
      downloads.push("update")
      return useAppUpdates.getState().update
    },
  }
  function render(phase: ReturnType<typeof useAppUpdates.getState>["update"]["phase"], error?: string) {
    flushSync(() => {
      useAppUpdates.setState({ update: { version: "0.1.0", enabled: true, phase, latestVersion: "0.2.0", progress: 42, error } })
      root.render(<AppUpdateControl />)
    })
    return host.querySelector<HTMLButtonElement>("button")!
  }
  try {
    let button = render("idle")
    if (!host.textContent?.includes("v0.1.0") || button.textContent?.trim() !== "Check") throw new Error("Footer must show current version and Check")
    button.click()
    if (checks !== 1) throw new Error("Check must request a release check")
    button = render("available")
    if (button.textContent?.trim() !== "Update" || !button.title.includes("0.2.0")) throw new Error("An available release must expose Update and the target version")
    button.click()
    if (downloads.join(",") !== "update") throw new Error("Update must request the download")
    button = render("downloading")
    if (!button.disabled || !button.textContent?.includes("42%")) throw new Error("Download must display progress and prevent duplicate clicks")
    button = render("downloaded")
    if (button.textContent?.trim() !== "Restart") throw new Error("A downloaded release must offer Restart")
    button.click()
    if (downloads.join(",") !== "update,update") throw new Error("Restart must request installation")
    button = render("available", "Connection lost")
    if (button.disabled || host.querySelector('[role="alert"]')?.textContent !== "Connection lost") throw new Error("Failed updates must show an error and allow retry")
    button = render("checking")
    if (!button.disabled || button.textContent?.trim() !== "Checking…") throw new Error("An active check must prevent duplicate clicks")
    console.log("PASS: version footer supports manual checks, updates, download progress, restart, and retry")
  } finally {
    window.edu = original
    flushSync(() => {
      useAppUpdates.setState({ update: { version: "", enabled: false, phase: "idle" } })
      root.render(null)
    })
  }
}
