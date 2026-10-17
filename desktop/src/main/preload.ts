import { contextBridge, ipcRenderer, webUtils } from "electron"
import {
  Channel,
  MaterialDraftSchema,
  SnapshotSchema,
  type DesktopBridge,
} from "../shared/contracts"

const bridge: DesktopBridge = {
  copyText: (text) => ipcRenderer.invoke(Channel.copyText, text),
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
  createTopic: (input) => ipcRenderer.invoke(Channel.createTopic, input),
  createChat: (input) => ipcRenderer.invoke(Channel.createChat, input),
  archiveTopic: (input) => ipcRenderer.invoke(Channel.archiveTopic, input),
  send: (input) => ipcRenderer.invoke(Channel.send, input),
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
  importMaterials: (owner, draftIds = []) =>
    ipcRenderer.invoke(Channel.importMaterials, { owner, draftIds }),
  exportNotes: (topicId) => ipcRenderer.invoke(Channel.exportNotes, topicId),
  openDiagnostics: (chatId) =>
    ipcRenderer.invoke(Channel.openDiagnostics, chatId),
  openWorkspace: (topicId) =>
    ipcRenderer.invoke(Channel.openWorkspace, topicId),
  openMaterial: (materialId) =>
    ipcRenderer.invoke(Channel.openMaterial, materialId),
}
contextBridge.exposeInMainWorld("prune", bridge)
