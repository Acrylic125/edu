import type { EventEmitter } from "node:events"
import type { AppUpdater, ProgressInfo, UpdateInfo } from "electron-updater"
import { AppUpdateSchema } from "../shared/app-updates"
import type { z } from "zod"

export const UPDATE_INTERVAL = 10 * 60 * 1000

type Updater = Pick<AppUpdater, "checkForUpdates" | "downloadUpdate" | "autoDownload" | "autoInstallOnAppQuit" | "allowPrerelease" | "allowDowngrade"> & Pick<EventEmitter, "on">

export class DesktopUpdates {
  state: z.infer<typeof AppUpdateSchema>
  private timer?: ReturnType<typeof setInterval>

  constructor(
    private updater: Updater,
    version: string,
    enabled: boolean,
    private notify: (state: z.infer<typeof AppUpdateSchema>) => void,
    private install: () => Promise<void>,
  ) {
    this.state = { version, enabled, phase: "idle" }
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.on("update-available", (info: UpdateInfo) => {
      this.set({ phase: "available", latestVersion: info.version, checkedAt: new Date().toISOString(), error: undefined })
    })
    updater.on("update-not-available", () => {
      this.set({ phase: "idle", latestVersion: undefined, checkedAt: new Date().toISOString(), error: undefined })
    })
    updater.on("download-progress", (info: ProgressInfo) => {
      this.set({ phase: "downloading", progress: Math.max(0, Math.min(100, info.percent)) })
    })
    updater.on("update-downloaded", (info: UpdateInfo) => {
      this.set({ phase: "downloaded", latestVersion: info.version, progress: 100, error: undefined })
    })
    updater.on("error", (error: Error) => this.failed(error))
  }

  private set(patch: Partial<z.infer<typeof AppUpdateSchema>>) {
    this.state = { ...this.state, ...patch }
    this.notify(this.state)
  }

  private failed(error: Error) {
    let phase: z.infer<typeof AppUpdateSchema>["phase"] = "idle"
    if (this.state.latestVersion) phase = "available"
    if (this.state.phase === "installing" || this.state.phase === "downloaded") phase = "downloaded"
    this.set({ phase, progress: undefined, error: error.message })
  }

  start() {
    if (!this.state.enabled || this.timer) return
    void this.check()
    this.timer = setInterval(() => void this.check(), UPDATE_INTERVAL)
    this.timer.unref()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = undefined
  }

  async check() {
    if (!this.state.enabled) return this.state
    if (this.state.phase !== "idle" && this.state.phase !== "available") return this.state
    this.set({ phase: "checking", error: undefined })
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      this.failed(error instanceof Error ? error : new Error("Could not check for updates."))
    }
    return this.state
  }

  async update() {
    if (!this.state.enabled) return this.state
    if (this.state.phase === "downloaded") {
      this.set({ phase: "installing", error: undefined })
      try {
        await this.install()
      } catch (error) {
        this.failed(error instanceof Error ? error : new Error("Could not install the update."))
      }
    } else if (this.state.phase === "available") {
      this.set({ phase: "downloading", progress: 0, error: undefined })
      try {
        await this.updater.downloadUpdate()
      } catch (error) {
        this.failed(error instanceof Error ? error : new Error("Could not download the update."))
      }
    }
    return this.state
  }
}
