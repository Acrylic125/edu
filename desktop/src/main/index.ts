import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  shell,
} from "electron"
import { z } from "zod"
import {
  Channel,
  CreateTopicSchema,
  IdSchema,
  ProviderIdSchema,
  RunnerInputSchema,
  SendSchema,
  SnapshotSchema,
} from "../shared/contracts"
import { ProviderRegistry } from "../providers/registry"
import { importMaterials } from "./materials"
import { newTopic, WorkspaceRepository } from "./workspace"
import { RunnerManager } from "../runners/manager"

const environment = z
  .object({
    ELECTRON_RENDERER_URL: z.string().url().optional(),
    PRUNE_DATA_DIR: z.string().refine(isAbsolute).optional(),
  })
  .parse(process.env)
protocol.registerSchemesAsPrivileged([
  {
    scheme: "prune-source",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])
if (environment.PRUNE_DATA_DIR)
  app.setPath("userData", environment.PRUNE_DATA_DIR)
let window: BrowserWindow | undefined
let manager: RunnerManager | undefined
let providers: ProviderRegistry | undefined
let quitting = false
const ownsLock = app.requestSingleInstanceLock()
if (!ownsLock) app.quit()
else {
  app.on("second-instance", () => {
    window?.show()
    window?.focus()
  })
  void app
    .whenReady()
    .then(async () => {
      const directory = join(app.getPath("userData"), "workspace")
      const repository = new WorkspaceRepository(directory)
      await repository.load()
      protocol.handle("prune-source", (request) => {
        const url = new URL(request.url)
        const id = IdSchema.safeParse(url.hostname)
        const page = /^\/(\d+)$/.exec(url.pathname)?.[1]
        if (!id.success || !page)
          return new Response("Source not found", { status: 404 })
        const topic = repository.stateSnapshot.topics.find((topic) =>
          topic.materials.some((material) => material.id === id.data),
        )
        if (!topic) return new Response("Source not found", { status: 404 })
        return net
          .fetch(
            pathToFileURL(
              join(
                directory,
                "topics",
                topic.id,
                "assets",
                `source-${id.data}-${page}.png`,
              ),
            ).href,
          )
          .catch(() => new Response("Source not found", { status: 404 }))
      })
      const resources = app.isPackaged
        ? join(process.resourcesPath, "resources")
        : join(app.getAppPath(), "resources")
      const registry = new ProviderRegistry(
        directory,
        join(
          resources,
          "codex",
          "bin",
          process.platform === "win32" ? "codex.exe" : "codex",
        ),
        notify,
      )
      providers = registry
      await registry.openrouter.load()
      const skillDirectory = app.isPackaged
        ? join(process.resourcesPath, "resources", "tutor-me")
        : join(app.getAppPath(), "resources", "tutor-me")
      const runnerManager = new RunnerManager(
        repository,
        join(__dirname, "worker.js"),
        skillDirectory,
        (runner) => registry.connection(runner),
        notify,
      )
      manager = runnerManager

      function snapshot() {
        return SnapshotSchema.parse({
          runners: repository.stateSnapshot.runners,
          topics: repository.publicTopics,
          runtime: runnerManager.statuses,
          connected: registry.openrouter.connected,
          providers: registry.statuses,
        })
      }
      function notify() {
        if (window && !window.isDestroyed())
          window.webContents.send(Channel.update, snapshot())
      }
      function trusted(event: Electron.IpcMainInvokeEvent) {
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("Untrusted desktop request.")
      }
      ipcMain.handle(Channel.snapshot, (event) => {
        trusted(event)
        return snapshot()
      })
      ipcMain.handle(Channel.connect, async (event, raw) => {
        trusted(event)
        await registry.connect(
          ProviderIdSchema.default("openrouter").parse(raw),
        )
        notify()
      })
      ipcMain.handle(Channel.disconnect, async (event, raw) => {
        trusted(event)
        const provider = ProviderIdSchema.default("openrouter").parse(raw)
        for (const runner of repository.stateSnapshot.runners) {
          if (runner.provider === provider) runnerManager.stop(runner.id)
        }
        await registry.disconnect(provider)
        notify()
      })
      ipcMain.handle(Channel.cancelConnection, async (event, raw) => {
        trusted(event)
        await registry.cancel(ProviderIdSchema.parse(raw))
      })
      ipcMain.handle(Channel.refreshProviders, async (event) => {
        trusted(event)
        await registry.refresh()
      })
      ipcMain.handle(Channel.updateRunner, async (event, rawId, rawInput) => {
        trusted(event)
        const id = IdSchema.parse(rawId)
        const input = RunnerInputSchema.parse(rawInput)
        registry.validateRunner(input)
        const runner = repository.stateSnapshot.runners.find(
          (item) => item.id === id,
        )
        if (!runner) throw new Error("Runner not found.")
        if (
          runner.provider !== input.provider &&
          repository.stateSnapshot.topics.some((topic) => topic.runnerId === id)
        )
          throw new Error(
            "Add another runner to change providers for a new topic.",
          )
        if (
          runnerManager.statuses.some(
            (runtime) =>
              runtime.runnerId === id && runtime.status === "running",
          )
        )
          throw new Error(
            "Wait for this runner to finish before changing its model.",
          )
        runnerManager.stop(id)
        await repository.mutate((state) => {
          const index = state.runners.findIndex((item) => item.id === id)
          state.runners[index] = { ...input, id }
        })
        notify()
      })
      ipcMain.handle(Channel.addRunner, async (event, raw) => {
        trusted(event)
        const input = RunnerInputSchema.parse(raw)
        registry.validateRunner(input)
        const id = randomUUID()
        await repository.mutate((workspace) => {
          if (workspace.runners.length >= 8)
            throw new Error("You can manage up to 8 runners.")
          workspace.runners.push({ ...input, id })
        })
        notify()
        return id
      })
      ipcMain.handle(Channel.removeRunner, async (event, raw) => {
        trusted(event)
        const id = IdSchema.parse(raw)
        if (
          repository.stateSnapshot.topics.some((topic) => topic.runnerId === id)
        )
          throw new Error(
            "This runner owns saved topics. Keep it stopped to preserve their handoffs.",
          )
        runnerManager.stop(id)
        await repository.mutate((workspace) => {
          workspace.runners = workspace.runners.filter(
            (runner) => runner.id !== id,
          )
        })
        notify()
      })
      ipcMain.handle(Channel.startRunner, (event, raw) => {
        trusted(event)
        runnerManager.start(IdSchema.parse(raw))
      })
      ipcMain.handle(Channel.stopRunner, (event, raw) => {
        trusted(event)
        runnerManager.stop(IdSchema.parse(raw))
      })
      ipcMain.handle(Channel.createTopic, async (event, raw) => {
        trusted(event)
        const { title, runnerId } = CreateTopicSchema.parse(raw)
        const topic = newTopic(title, runnerId)
        await repository.mutate((workspace) => {
          if (!workspace.runners.some((runner) => runner.id === runnerId))
            throw new Error("Runner not found.")
          workspace.topics.unshift(topic)
        })
        notify()
        return topic.id
      })
      ipcMain.handle(Channel.send, async (event, raw) => {
        trusted(event)
        await runnerManager.send(SendSchema.parse(raw))
      })
      ipcMain.handle(Channel.importMaterials, async (event, raw) => {
        trusted(event)
        const id = IdSchema.parse(raw)
        if (
          runnerManager.statuses.some(
            (runtime) => runtime.topicId === id && runtime.status === "running",
          )
        )
          throw new Error("Wait for the current lesson before adding sources.")
        await importMaterials(repository, id)
        notify()
      })
      ipcMain.handle(Channel.exportNotes, async (event, raw) => {
        trusted(event)
        const topic = repository.topic(IdSchema.parse(raw))
        const result = await dialog.showOpenDialog({
          title: "Export study notes",
          properties: ["openDirectory", "createDirectory"],
        })
        if (!result.canceled && result.filePaths[0])
          await repository.exportStudyFiles(topic, result.filePaths[0])
      })
      ipcMain.handle(Channel.openDiagnostics, async (event, raw) => {
        trusted(event)
        const topic = repository.topic(IdSchema.parse(raw))
        const path = join(directory, "topics", topic.id, "diagnostics")
        await mkdir(path, { recursive: true, mode: 0o700 })
        const error = await shell.openPath(path)
        if (error) throw new Error(error)
      })
      ipcMain.handle(Channel.openWorkspace, async (event, raw) => {
        trusted(event)
        const topic = repository.topic(IdSchema.parse(raw))
        const path = join(directory, "topics", topic.id)
        await mkdir(path, { recursive: true, mode: 0o700 })
        const error = await shell.openPath(path)
        if (error) throw new Error(error)
      })

      function createWindow() {
        window = new BrowserWindow({
          width: 1440,
          height: 940,
          minWidth: 960,
          minHeight: 640,
          title: "Prune",
          backgroundColor: "#fafafa",
          webPreferences: {
            preload: join(__dirname, "../preload/index.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        })
        window.webContents.setWindowOpenHandler(({ url }) => {
          if (/^https:\/\//.test(url)) void shell.openExternal(url)
          return { action: "deny" }
        })
        window.webContents.on("will-navigate", (event) =>
          event.preventDefault(),
        )
        window.webContents.session.setPermissionRequestHandler(
          (_contents, _permission, callback) => callback(false),
        )
        if (!app.isPackaged && environment.ELECTRON_RENDERER_URL)
          void window.loadURL(environment.ELECTRON_RENDERER_URL)
        else void window.loadFile(join(__dirname, "../renderer/index.html"))
        window.on("closed", () => {
          window = undefined
        })
      }
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "Prune",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "quit" },
            ],
          },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ]),
      )
      createWindow()
      void registry.refresh()
      app.on("activate", () => {
        if (!window) createWindow()
      })
    })
    .catch((error) => {
      dialog.showErrorBox(
        "Prune could not start",
        error instanceof Error
          ? error.message
          : "Could not load the workspace.",
      )
      app.quit()
    })
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
app.on("before-quit", (event) => {
  if (quitting) return
  event.preventDefault()
  providers?.close()
  void (manager?.shutdown() ?? Promise.resolve()).finally(() => {
    quitting = true
    app.quit()
  })
})
