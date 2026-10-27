import { create } from "zustand"
import type { Snapshot } from "../shared/contracts"
import { useChatTabs } from "./chat-tabs"
import { useTopicViews } from "./topic-views"

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
    topics: [],
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
    const activeChatId = useChatTabs.getState().activeId
    const previousChat = get().snapshot.chats.find((chat) => chat.id === activeChatId)
    const currentChat = snapshot.chats.find((chat) => chat.id === activeChatId)
    useChatTabs.getState().reconcile(snapshot.chats.map((chat) => chat.id))
    useTopicViews.getState().reconcile(snapshot.topics.map((topic) => topic.id))
    if (previousChat?.scratchpadRequested && currentChat && !currentChat.scratchpadRequested && !useTopicViews.getState().activeId) {
      const createdId = currentChat.messages.at(-1)?.topicIds[0]
      if (createdId && snapshot.topics.some((topic) => topic.id === createdId)) useTopicViews.getState().select(createdId)
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
  let changed = false
  window.edu.subscribe((snapshot) => {
    changed = true
    useWorkspace.getState().setSnapshot(snapshot)
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
