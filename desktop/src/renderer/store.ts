import { isStagedChat } from "../shared/thread-ownership"
import { create } from "zustand"
import type { Snapshot } from "../shared/contracts"
import { useChatTabs } from "./chat-tabs"
import { stagingId, useTopicViews } from "./topic-views"

export const useWorkspace = create<{
  snapshot: Snapshot
  loaded: boolean
  providerSetupComplete: boolean
  error: string | null
  pendingMessages: {
    chatId: string
    message: Snapshot["chats"][number]["messages"][number]
    materials: Pick<Snapshot["chats"][number]["materials"][number], "id" | "name">[]
  }[]
  setSnapshot: (snapshot: Snapshot) => void
  setError: (error: string | null) => void
}>((set, get) => ({
  snapshot: {
    runners: [],
    scratchpads: [],
    chats: [],
    runtime: [],
    connected: false,
    providers: [],
  },
  loaded: false,
  providerSetupComplete: false,
  error: null,
  pendingMessages: [],
  setSnapshot: (snapshot) => {
    let activeChatId = useChatTabs.getState().activeId
    const previousChat = get().snapshot.chats.find((chat) => chat.id === activeChatId)
    let currentChat = snapshot.chats.find((chat) => chat.id === activeChatId)
    const previousRequest = previousChat?.messages.findLast((message) => message.role === "user")
    if (previousChat?.ownerScratchpadId && previousRequest && currentChat && !currentChat.messages.some((message) => message.id === previousRequest.id)) {
      const destination = snapshot.chats.find((chat) => chat.id !== activeChatId && chat.messages.some((message) => message.id === previousRequest.id))
      if (destination) {
        activeChatId = destination.id
        currentChat = destination
        useTopicViews.getState().select(destination.ownerScratchpadId ?? stagingId)
      }
    }
    useTopicViews.getState().reconcile(snapshot.scratchpads.map((scratchpad) => scratchpad.id))
    if (previousChat && currentChat?.ownerScratchpadId && previousChat.ownerScratchpadId !== currentChat.ownerScratchpadId) {
      useTopicViews.getState().select(currentChat.ownerScratchpadId)
    }
    if (useTopicViews.getState().activeId === stagingId && activeChatId !== "new" && !currentChat) {
      useTopicViews.getState().select(undefined)
    }
    const scratchpadId = useTopicViews.getState().activeId
    let chats = snapshot.chats.filter((chat) => scratchpadId !== undefined && chat.ownerScratchpadId === scratchpadId)
    let scope = scratchpadId
    if (scratchpadId === stagingId) {
      chats = snapshot.chats.filter((chat) => chat.id === activeChatId && isStagedChat(chat))
      scope = `${stagingId}:${chats[0]?.id ?? "new"}`
    }
    useChatTabs.getState().reconcile(chats.map((chat) => chat.id), scope)
    if (currentChat && currentChat.id !== previousChat?.id) {
      useChatTabs.getState().select(currentChat.id)
    }
    if (currentChat && currentChat.ownerScratchpadId === scratchpadId && previousChat?.ownerScratchpadId !== currentChat.ownerScratchpadId) {
      useChatTabs.getState().select(currentChat.id)
    }
    const providerConnected = snapshot.providers.some((provider) => provider.connected)
    const savedMessageIds = new Set(snapshot.chats.flatMap((chat) => chat.messages.map((message) => message.id)))
    // Keep access for this window after setup, even if a provider later disconnects.
    set((state) => ({
      snapshot,
      pendingMessages: state.pendingMessages.filter((pending) => !savedMessageIds.has(pending.message.id)),
      // The initial account checks must settle before a disconnected snapshot can require setup.
      loaded: state.loaded || providerConnected || snapshot.providers.every((provider) => !provider.loading),
      providerSetupComplete: state.providerSetupComplete || providerConnected,
    }))
  },
  setError: (error) => set({ error }),
}))

useTopicViews.subscribe((state, previous) => {
  if (state.activeId === previous.activeId) return
  const snapshot = useWorkspace.getState().snapshot
  let chats = snapshot.chats.filter((chat) => state.activeId !== undefined && chat.ownerScratchpadId === state.activeId)
  let scope = state.activeId
  if (state.activeId === stagingId) {
    const activeChatId = useChatTabs.getState().activeId
    chats = snapshot.chats.filter((chat) => chat.id === activeChatId && isStagedChat(chat))
    scope = `${stagingId}:${chats[0]?.id ?? "new"}`
  }
  useChatTabs.getState().reconcile(chats.map((chat) => chat.id), scope)
})

export function desktop() {
  if (!window.edu)
    throw new Error(
      "Open the EdU desktop app to connect accounts and run tutors.",
    )
  return window.edu
}

export function desktopErrorMessage(error: Error) {
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
}

export async function initializeWorkspace() {
  if (!window.edu) {
    useWorkspace.setState({ loaded: true })
    return
  }
  const { transitionWorkspace } = await import("@edu/ui/workspace")
  let snapshotVersion = 0
  let changed = false
  window.edu.subscribe((snapshot) => {
    changed = true
    const version = ++snapshotVersion
    const current = useWorkspace.getState().snapshot
    const activeId = useChatTabs.getState().activeId
    const previousOwner = current.chats.find((chat) => chat.id === activeId)?.ownerScratchpadId
    const owner = snapshot.chats.find((chat) => chat.id === activeId)?.ownerScratchpadId
    if (useTopicViews.getState().activeId === stagingId && owner && owner !== previousOwner) {
      transitionWorkspace(() => {
        if (version === snapshotVersion) useWorkspace.getState().setSnapshot(snapshot)
      })
    } else useWorkspace.getState().setSnapshot(snapshot)
  })
  window.edu.subscribeRuntime(({ runtime }) => {
    useWorkspace.setState((state) => ({ snapshot: { ...state.snapshot, runtime } }))
  })
  try {
    const snapshot = await window.edu.snapshot()
    if (!changed) useWorkspace.getState().setSnapshot(snapshot)
  } catch (error) {
    useWorkspace.setState({
      loaded: true,
      error:
        error instanceof Error
          ? error.message
          : "Could not load your workspace.",
    })
  }
}
