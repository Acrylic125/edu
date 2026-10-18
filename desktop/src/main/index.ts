import { randomUUID } from "node:crypto"
import { access, constants, mkdir, stat } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
} from "electron"
import { z } from "zod"
import {
  Channel,
  ArchiveTopicSchema,
  CreateChatSchema,
  CreateTopicSchema,
  DroppedMaterialsSchema,
  IdSchema,
  ImportMaterialsSchema,
  MaterialDraftIdsSchema,
  PastedMaterialsSchema,
  MessageSchema,
  ProviderIdSchema,
  ProviderSettingsSchema,
  RunnerInputSchema,
  SendSchema,
  SnapshotSchema,
} from "../shared/contracts"
import { resolveCliExecutable } from "../providers/cli"
import { ProviderRegistry } from "../providers/registry"
import { importMaterials, MaterialDrafts } from "./materials"
import { readSourceImages } from "./source-images"
import { newChat, WorkspaceRepository } from "./workspace"
import { RunnerManager } from "../runners/manager"
import { installPhoenixExporter } from "../runners/telemetry"

const environment = z
  .object({
    ELECTRON_RENDERER_URL: z.string().url().optional(),
    PRUNE_DATA_DIR: z.string().refine(isAbsolute).optional(),
  })
  .parse(process.env)
app.setName("EdU")
protocol.registerSchemesAsPrivileged([
  {
    scheme: "prune-source",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])
if (environment.PRUNE_DATA_DIR)
  app.setPath("userData", environment.PRUNE_DATA_DIR)
else
  // Preserve existing workspaces and keychain accounts through the EdU rename.
  app.setPath("userData", join(app.getPath("appData"), "prune-desktop"))
let window: BrowserWindow | undefined
let manager: RunnerManager | undefined
let providers: ProviderRegistry | undefined
let quitting = false
let shuttingDown = false
const ownsLock = app.requestSingleInstanceLock()
if (!ownsLock) app.quit()
else {
  app.on("second-instance", () => {
    if (shuttingDown) return
    window?.show()
    window?.focus()
  })
  void app
    .whenReady()
    .then(async () => {
      const directory = join(app.getPath("userData"), "workspace")
      const repository = new WorkspaceRepository(directory)
      await repository.load()
      const phoenixResources = app.isPackaged
        ? join(process.resourcesPath, "phoenix")
        : join(app.getAppPath(), "..", "phoenix")
      const phoenixExporterInstalled = await installPhoenixExporter(phoenixResources, directory)
      const materialDrafts = new MaterialDrafts()
      protocol.handle("prune-source", async (request) => {
        const url = new URL(request.url)
        const id = IdSchema.safeParse(url.hostname)
        const page = z.coerce.number().int().min(1).max(1000).safeParse(/^\/(\d+)$/.exec(url.pathname)?.[1])
        if (!id.success || !page.success)
          return new Response("Source not found", { status: 404 })
        const { topics, chats } = repository.stateSnapshot
        for (const [collection, owners] of [["topics", topics], ["chats", chats]] as const) {
          const owner = owners.find((item) => item.materials.some((material) => material.id === id.data))
          const material = owner?.materials.find((item) => item.id === id.data)
          if (!owner || !material) continue
          if (material.kind !== "pdf" && material.kind !== "image") break
          if (page.data > (material.pages.length || 1)) break
          try {
            const [png] = await readSourceImages(material, join(directory, collection, owner.id, "assets"), page.data, page.data)
            return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } })
          } catch {
            return new Response("Source not found", { status: 404 })
          }
        }
        return new Response("Source not found", { status: 404 })
      })
      const resources = app.isPackaged
        ? join(process.resourcesPath, "resources")
        : join(app.getAppPath(), "resources")
      app.dock?.setIcon(join(resources, "icon.png"))
      const registry = new ProviderRegistry(
        directory,
        join(
          resources,
          "codex",
          "bin",
          process.platform === "win32" ? "codex.exe" : "codex",
        ),
        notify,
        repository.stateSnapshot.providerSettings,
      )
      providers = registry
      const skillDirectory = app.isPackaged
        ? join(process.resourcesPath, "resources", "tutor-me")
        : join(app.getAppPath(), "resources", "tutor-me")
      const runnerManager = new RunnerManager(
        repository,
        join(__dirname, "worker.js"),
        skillDirectory,
        (runner) => registry.connection(runner),
        notify,
        phoenixExporterInstalled,
      )
      manager = runnerManager

      function snapshot() {
        return SnapshotSchema.parse({
          runners: repository.stateSnapshot.runners,
          topics: repository.publicTopics,
          chats: repository.publicChats,
          runtime: runnerManager.statuses,
          connected: registry.statuses.some((provider) => provider.connected),
          providers: registry.statuses,
        })
      }
      function notify() {
        if (window && !window.isDestroyed())
          window.webContents.send(Channel.update, snapshot())
      }
      function trusted(event: Electron.IpcMainInvokeEvent) {
        if (shuttingDown) throw new Error("EdU is shutting down.")
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("Untrusted desktop request.")
      }
      ipcMain.handle(Channel.copyText, async (event, raw) => {
        trusted(event)
        await clipboard.writeText(MessageSchema.shape.content.parse(raw))
      })
      ipcMain.handle(Channel.snapshot, async (event) => {
        trusted(event)
        await repository.refreshTopics()
        return snapshot()
      })
      async function saveCliConnection(id: z.infer<typeof ProviderIdSchema>, enabled: boolean) {
        if (id !== "claude" && id !== "antigravity") return
        await repository.mutate((workspace) => {
          const settings = workspace.providerSettings.find((item) => item.id === id)
          if (settings) settings.enabled = enabled
        })
        const settings = repository.stateSnapshot.providerSettings.find((item) => item.id === id)
        if (settings) registry.configure(settings)
      }
      ipcMain.handle(Channel.connect, async (event, raw) => {
        trusted(event)
        const provider = ProviderIdSchema.default("codex").parse(raw)
        if (registry.statuses.some((item) => item.id === provider && item.connecting)) return
        if (provider === "claude" || provider === "antigravity") {
          const previous = repository.stateSnapshot.providerSettings.find((item) => item.id === provider)
          if (!previous?.binaryPath) {
            const binaryPath = await resolveCliExecutable(provider)
            const settings = ProviderSettingsSchema.parse({
              ...previous,
              id: provider,
              displayName: previous?.displayName ?? registry.statuses.find((item) => item.id === provider)?.name ?? provider,
              binaryPath,
            })
            await repository.mutate((workspace) => {
              workspace.providerSettings = [...workspace.providerSettings.filter((item) => item.id !== provider), settings]
            })
            registry.configure(settings)
            notify()
          }
        }
        await registry.connect(provider)
        await saveCliConnection(provider, true)
        notify()
      })
      ipcMain.handle(Channel.disconnect, async (event, raw) => {
        trusted(event)
        const provider = ProviderIdSchema.default("codex").parse(raw)
        for (const runner of repository.stateSnapshot.runners) {
          if (runner.provider === provider) runnerManager.stop(runner.id)
        }
        await registry.disconnect(provider)
        await saveCliConnection(provider, false)
        notify()
      })
      ipcMain.handle(Channel.cancelConnection, async (event, raw) => {
        trusted(event)
        await registry.cancel(ProviderIdSchema.parse(raw))
      })
      ipcMain.handle(Channel.refreshProviders, async (event, raw) => {
        trusted(event)
        await registry.refresh(ProviderIdSchema.optional().parse(raw))
      })
      ipcMain.handle(Channel.saveProvider, async (event, raw) => {
        trusted(event)
        const settings = ProviderSettingsSchema.parse(raw)
        const previous = repository.stateSnapshot.providerSettings.find((item) => item.id === settings.id)
        settings.enabled = previous?.enabled ?? false
        if (settings.binaryPath !== (previous?.binaryPath ?? "")) settings.enabled = false
        if (settings.binaryPath) {
          if (!isAbsolute(settings.binaryPath))
            throw new Error("Enter an absolute binary path.")
          if (!(await stat(settings.binaryPath)).isFile())
            throw new Error("Choose an executable file for the binary path.")
          await access(settings.binaryPath, constants.X_OK)
        }
        const changesBinary = settings.binaryPath !== (previous?.binaryPath ?? "")
        if (changesBinary) {
          if (registry.statuses.some((provider) => provider.id === settings.id && (provider.connecting || provider.loading)))
            throw new Error("Wait for the provider to finish connecting before changing its binary.")
          const ids = repository.stateSnapshot.runners.filter((runner) => runner.provider === settings.id).map((runner) => runner.id)
          if (runnerManager.statuses.some((runtime) => ids.includes(runtime.runnerId) && runtime.status === "running"))
            throw new Error("Wait for your tutor to finish before changing its binary.")
          for (const id of ids) runnerManager.stop(id)
        }
        await repository.mutate((workspace) => {
          workspace.providerSettings = [...workspace.providerSettings.filter((item) => item.id !== settings.id), settings]
        })
        registry.configure(settings)
        notify()
        if (changesBinary) await registry.refresh(settings.id)
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
          repository.stateSnapshot.chats.some((chat) => chat.runnerId === id)
        )
          throw new Error(
            "Add another runner to change providers for a new chat.",
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
          repository.stateSnapshot.chats.some((chat) => chat.runnerId === id)
        )
          throw new Error(
            "This runner owns saved chats. Keep it stopped to preserve their handoffs.",
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
      ipcMain.handle(Channel.stopRunner, (event, raw, rawChatId) => {
        trusted(event)
        runnerManager.stop(IdSchema.parse(raw), IdSchema.optional().parse(rawChatId))
      })
      ipcMain.handle(Channel.createTopic, async (event, raw) => {
        trusted(event)
        return runnerManager.createTopic(CreateTopicSchema.parse(raw))
      })
      ipcMain.handle(Channel.createChat, async (event, raw) => {
        trusted(event)
        const chat = newChat(CreateChatSchema.parse(raw).runnerId)
        await repository.mutate((workspace) => {
          if (!workspace.runners.some((runner) => runner.id === chat.runnerId))
            throw new Error("Runner not found.")
          workspace.chats.unshift(chat)
        })
        notify()
        return chat.id
      })
      ipcMain.handle(Channel.archiveTopic, async (event, raw) => {
        trusted(event)
        const { topicId, archived } = ArchiveTopicSchema.parse(raw)
        await repository.mutate((workspace) => {
          const topic = workspace.topics.find((item) => item.id === topicId)
          if (!topic) throw new Error("This topic no longer exists.")
          topic.archived = archived
        })
        notify()
      })
      ipcMain.handle(Channel.send, async (event, raw) => {
        trusted(event)
        await runnerManager.send(SendSchema.parse(raw))
      })
      ipcMain.handle(Channel.selectMaterials, async (event, raw) => {
        trusted(event)
        return materialDrafts.select(MaterialDraftIdsSchema.parse(raw))
      })
      ipcMain.handle(Channel.dropMaterials, async (event, raw) => {
        trusted(event)
        const { paths, draftIds } = DroppedMaterialsSchema.parse(raw)
        if (paths.some((path) => !isAbsolute(path)))
          throw new Error("Drop files from your computer to attach them.")
        return materialDrafts.add(draftIds, paths)
      })
      ipcMain.handle(Channel.pasteMaterials, async (event, raw) => {
        trusted(event)
        const { images, draftIds } = PastedMaterialsSchema.parse(raw)
        return materialDrafts.paste(draftIds, images)
      })
      ipcMain.handle(Channel.discardMaterials, (event, raw) => {
        trusted(event)
        materialDrafts.discard(MaterialDraftIdsSchema.parse(raw))
      })
      ipcMain.handle(Channel.importMaterials, async (event, raw) => {
        trusted(event)
        const { owner, draftIds } = ImportMaterialsSchema.parse(raw)
        const { chats } = repository.stateSnapshot
        const busy = runnerManager.statuses.some((runtime) => {
          if (runtime.status !== "running") return false
          if (owner.kind === "chat") return runtime.chatId === owner.id
          return chats.some(
            (chat) =>
              chat.id === runtime.chatId &&
              chat.messages.some((message) => message.topicIds.includes(owner.id)),
          )
        })
        if (busy)
          throw new Error("Wait for the current lesson before adding sources.")
        if (draftIds.length > 0) await materialDrafts.import(repository, owner, draftIds)
        else await importMaterials(repository, owner)
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
        const chat = repository.chat(IdSchema.parse(raw))
        const path = join(directory, "chats", chat.id, "diagnostics")
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
      ipcMain.handle(Channel.openMaterial, async (event, raw) => {
        trusted(event)
        const id = IdSchema.parse(raw)
        const { topics, chats } = repository.stateSnapshot
        for (const [collection, owners] of [["topics", topics], ["chats", chats]] as const) {
          const owner = owners.find((item) => item.materials.some((material) => material.id === id))
          const material = owner?.materials.find((item) => item.id === id)
          if (!owner || !material) continue
          const error = await shell.openPath(join(directory, collection, owner.id, "assets", material.name))
          if (error) throw new Error(error)
          return
        }
        throw new Error("Source not found. It may have been removed from this workspace.")
      })

      function createWindow() {
        window = new BrowserWindow({
          width: 1440,
          height: 940,
          minWidth: 960,
          minHeight: 640,
          title: "EdU",
          icon: join(resources, "icon.png"),
          titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
          trafficLightPosition: { x: 18, y: 20 },
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
            label: "EdU",
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
      registry.startPolling()
      app.on("activate", () => {
        if (shuttingDown) return
        if (!window) createWindow()
      })
    })
    .catch((error) => {
      dialog.showErrorBox(
        "EdU could not start",
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
  if (shuttingDown) return
  shuttingDown = true
  window?.hide()
  providers?.close()
  void (manager?.shutdown() ?? Promise.resolve()).finally(() => {
    quitting = true
    app.quit()
  })
})
