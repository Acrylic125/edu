import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { DesktopUpdates, UPDATE_INTERVAL } from "./app-updates"

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  checks = 0
  downloads = 0
  available = false
  failDownload = false
  async checkForUpdates() {
    this.checks++
    this.emit(this.available ? "update-available" : "update-not-available", { version: "0.2.0" })
    return null
  }
  async downloadUpdate() {
    this.downloads++
    if (this.failDownload) throw new Error("Connection lost")
    this.emit("download-progress", { percent: 42 })
    this.emit("update-downloaded", { version: "0.2.0" })
    return ["update.zip"]
  }
}

test("checks on startup and every ten minutes, and stops polling at shutdown", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const updater = new FakeUpdater()
  const updates = new DesktopUpdates(updater, "0.1.0", true, () => {}, async () => {})
  updates.start()
  updates.start()
  assert.equal(updater.checks, 1)
  t.mock.timers.tick(UPDATE_INTERVAL - 1)
  assert.equal(updater.checks, 1)
  t.mock.timers.tick(1)
  assert.equal(updater.checks, 2)
  updates.stop()
  t.mock.timers.tick(UPDATE_INTERVAL)
  assert.equal(updater.checks, 2)
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
})

test("only downloads on request and waits for a separate restart action", async () => {
  const updater = new FakeUpdater()
  updater.available = true
  let installs = 0
  const phases: string[] = []
  const updates = new DesktopUpdates(updater, "0.1.0", true, (state) => phases.push(state.phase), async () => { installs++ })
  await updates.check()
  assert.equal(updates.state.latestVersion, "0.2.0")
  assert.equal(updater.downloads, 0)
  await updates.update()
  assert.ok(phases.includes("downloading"))
  assert.equal(updates.state.phase, "downloaded")
  assert.equal(installs, 0)
  await updates.check()
  assert.equal(updates.state.phase, "downloaded")
  assert.equal(updater.checks, 1)
  await updates.update()
  assert.equal(installs, 1)
  assert.equal(updates.state.phase, "installing")
})

test("failed downloads retain the release and can be retried", async () => {
  const updater = new FakeUpdater()
  updater.available = true
  updater.failDownload = true
  const updates = new DesktopUpdates(updater, "0.1.0", true, () => {}, async () => {})
  await updates.check()
  await updates.update()
  assert.equal(updates.state.phase, "available")
  assert.equal(updates.state.error, "Connection lost")
  updater.failDownload = false
  await updates.update()
  assert.equal(updates.state.phase, "downloaded")
  assert.equal(updates.state.error, undefined)
})

test("development builds never check, download, or install", async () => {
  const updater = new FakeUpdater()
  const updates = new DesktopUpdates(updater, "0.1.0", false, () => {}, async () => { assert.fail("Must not install") })
  updates.start()
  await updates.check()
  await updates.update()
  assert.equal(updater.checks, 0)
  assert.equal(updater.downloads, 0)
})
