import { create } from "zustand"
import type { Snapshot } from "../shared/contracts"
import { useChatTabs } from "./chat-tabs"
import { useTopicViews } from "./topic-views"

export const useWorkspace = create<{
  snapshot: Snapshot
  loaded: boolean
  error: string | null
  setSnapshot: (snapshot: Snapshot) => void
  setError: (error: string | null) => void
}>((set) => ({
  snapshot: {
    runners: [],
    topics: [],
    chats: [],
    runtime: [],
    connected: false,
    providers: [],
  },
  loaded: false,
  error: null,
  setSnapshot: (snapshot) => {
    useChatTabs.getState().reconcile(snapshot.chats.map((chat) => chat.id))
    useTopicViews.getState().reconcile(snapshot.topics.map((topic) => topic.id))
    set({ snapshot, loaded: true })
  },
  setError: (error) => set({ error }),
}))

export function desktop() {
  if (!window.prune)
    throw new Error(
      "Open the EdU desktop app to connect accounts and run tutors.",
    )
  return window.prune
}

export function desktopErrorMessage(error: Error) {
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
}

export async function initializeWorkspace() {
  if (!window.prune) {
    useWorkspace.setState({ loaded: true })
    return
  }
  let changed = false
  window.prune.subscribe((snapshot) => {
    changed = true
    useWorkspace.getState().setSnapshot(snapshot)
  })
  try {
    const snapshot = await window.prune.snapshot()
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
