import { AppUpdateSchema } from "../shared/app-updates"
import { contextBridge, ipcRenderer, webUtils } from "electron"
import {
  Channel,
  MaterialDraftSchema,
  SnapshotSchema,
  RuntimeUpdateSchema,
  type DesktopBridge,
} from "../shared/contracts"

const bridge: DesktopBridge = {
  appUpdateState: async () => AppUpdateSchema.parse(await ipcRenderer.invoke(Channel.appUpdateState)),
  checkAppUpdate: async () => AppUpdateSchema.parse(await ipcRenderer.invoke(Channel.checkAppUpdate)),
  installAppUpdate: async () => AppUpdateSchema.parse(await ipcRenderer.invoke(Channel.installAppUpdate)),
  subscribeAppUpdates: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof AppUpdateSchema.parse>[0]) => listener(AppUpdateSchema.parse(payload))
    ipcRenderer.on(Channel.appUpdateChanged, receive)
    return () => ipcRenderer.removeListener(Channel.appUpdateChanged, receive)
  },
  copyText: (text, materialIds = []) => ipcRenderer.invoke(Channel.copyText, { text, materialIds }),
  reuseMaterials: async (materialIds, draftIds = []) => MaterialDraftSchema.array().parse(await ipcRenderer.invoke(Channel.reuseMaterials, { materialIds, draftIds })),
  snapshot: async () =>
    SnapshotSchema.parse(await ipcRenderer.invoke(Channel.snapshot)),
  subscribe: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof SnapshotSchema.parse>[0],
    ) => listener(SnapshotSchema.parse(payload))
    ipcRenderer.on(Channel.update, receive)
    return () => ipcRenderer.removeListener(Channel.update, receive)
  },
  subscribeRuntime: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof RuntimeUpdateSchema.parse>[0]) => listener(RuntimeUpdateSchema.parse(payload))
    ipcRenderer.on(Channel.runtimeUpdate, receive)
    return () => ipcRenderer.removeListener(Channel.runtimeUpdate, receive)
  },
  connect: (provider) => ipcRenderer.invoke(Channel.connect, provider),
  disconnect: (provider) => ipcRenderer.invoke(Channel.disconnect, provider),
  cancelConnection: (provider) =>
    ipcRenderer.invoke(Channel.cancelConnection, provider),
  refreshProviders: (provider) => ipcRenderer.invoke(Channel.refreshProviders, provider),
  saveProvider: (input) => ipcRenderer.invoke(Channel.saveProvider, input),
  updateRunner: (id, input) =>
    ipcRenderer.invoke(Channel.updateRunner, id, input),
  addRunner: (input) => ipcRenderer.invoke(Channel.addRunner, input),
  removeRunner: (id) => ipcRenderer.invoke(Channel.removeRunner, id),
  startRunner: (id) => ipcRenderer.invoke(Channel.startRunner, id),
  stopRunner: (id, chatId) => ipcRenderer.invoke(Channel.stopRunner, id, chatId),
  createScratchpad: (input) => ipcRenderer.invoke(Channel.createScratchpad, input),
  createChat: (input) => ipcRenderer.invoke(Channel.createChat, input),
  deleteStagedChat: (chatId) => ipcRenderer.invoke(Channel.deleteStagedChat, chatId),
  archiveScratchpad: (input) => ipcRenderer.invoke(Channel.archiveScratchpad, input),
  reconcileScratchpad: (input) => ipcRenderer.invoke(Channel.reconcileScratchpad, input),
  send: (input) => ipcRenderer.invoke(Channel.send, input),
  retry: (input) => ipcRenderer.invoke(Channel.retry, input),
  selectMaterials: async (draftIds) =>
    MaterialDraftSchema.array().parse(await ipcRenderer.invoke(Channel.selectMaterials, draftIds)),
  dropMaterials: async (files, draftIds = []) => {
    const paths = files.map((file) => webUtils.getPathForFile(file))
    if (paths.some((path) => !path))
      throw new Error("Drop files from your computer to attach them.")
    return MaterialDraftSchema.array().parse(
      await ipcRenderer.invoke(Channel.dropMaterials, { paths, draftIds }),
    )
  },
  pasteMaterials: async (images, draftIds = []) =>
    MaterialDraftSchema.array().parse(await ipcRenderer.invoke(Channel.pasteMaterials, { images, draftIds })),
  discardMaterials: (draftIds) => ipcRenderer.invoke(Channel.discardMaterials, draftIds),
  removeChatMaterial: (chatId, materialId) => ipcRenderer.invoke(Channel.removeChatMaterial, { chatId, materialId }),
  importMaterials: (owner, draftIds = []) =>
    ipcRenderer.invoke(Channel.importMaterials, { owner, draftIds }),
  exportNotes: (scratchpadId) => ipcRenderer.invoke(Channel.exportNotes, scratchpadId),
  openDiagnostics: (chatId) =>
    ipcRenderer.invoke(Channel.openDiagnostics, chatId),
  openWorkspace: (scratchpadId) =>
    ipcRenderer.invoke(Channel.openWorkspace, scratchpadId),
  openMaterial: (materialId) =>
    ipcRenderer.invoke(Channel.openMaterial, materialId),
}
contextBridge.exposeInMainWorld("edu", bridge)
