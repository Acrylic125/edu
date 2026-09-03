import type { ChatStoreState, ShellPhase } from "./types"

export function selectShellPhase(state: ChatStoreState): ShellPhase {
  if (state.socket.status === "error" && !state.revealed) {
    return { show: "error", message: state.socket.message }
  }
  if (state.switch !== null) {
    return { show: "skeleton", reason: "switch" }
  }
  if (state.socket.status === "boot") {
    return { show: "skeleton", reason: "boot" }
  }
  if (state.socket.status === "connecting" && !state.revealed) {
    return { show: "skeleton", reason: "connecting" }
  }

  if (state.session.kind === "none") {
    return {
      show: "thread",
      topicId: null,
      title: "",
      messages: [],
      empty: true,
      handoff: null,
    }
  }

  return {
    show: "thread",
    topicId: state.session.topicId,
    title: state.session.title,
    messages: state.session.messages,
    empty: state.session.messages.length === 0,
    handoff: state.session.handoff,
  }
}

export function headerStatus(state: ChatStoreState) {
  if (state.socket.status === "boot" || state.socket.status === "connecting") {
    return { label: "Connecting", tone: "muted" as const }
  }
  if (state.socket.status === "error") {
    return { label: state.socket.message, tone: "destructive" as const }
  }
  if (state.run.status === "running") {
    return { label: "Working…", tone: "muted" as const }
  }
  return { label: "Online", tone: "muted" as const }
}
