import { contextBridge, ipcRenderer } from "electron"
import {
  Channel,
  SnapshotSchema,
  type DesktopBridge,
} from "../shared/contracts"

const bridge: DesktopBridge = {
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
  refreshProviders: () => ipcRenderer.invoke(Channel.refreshProviders),
  saveProvider: (input) => ipcRenderer.invoke(Channel.saveProvider, input),
  updateRunner: (id, input) =>
    ipcRenderer.invoke(Channel.updateRunner, id, input),
  addRunner: (input) => ipcRenderer.invoke(Channel.addRunner, input),
  removeRunner: (id) => ipcRenderer.invoke(Channel.removeRunner, id),
  startRunner: (id) => ipcRenderer.invoke(Channel.startRunner, id),
  stopRunner: (id) => ipcRenderer.invoke(Channel.stopRunner, id),
  createTopic: (input) => ipcRenderer.invoke(Channel.createTopic, input),
  createChat: (input) => ipcRenderer.invoke(Channel.createChat, input),
  send: (input) => ipcRenderer.invoke(Channel.send, input),
  importMaterials: (owner) =>
    ipcRenderer.invoke(Channel.importMaterials, owner),
  exportNotes: (topicId) => ipcRenderer.invoke(Channel.exportNotes, topicId),
  openDiagnostics: (chatId) =>
    ipcRenderer.invoke(Channel.openDiagnostics, chatId),
  openWorkspace: (topicId) =>
    ipcRenderer.invoke(Channel.openWorkspace, topicId),
}
contextBridge.exposeInMainWorld("prune", bridge)
