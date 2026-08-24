import type { Gate, RunFact, SocketFact } from "./types"

export function sendGate(
  socket: SocketFact,
  run: RunFact,
  draft: string,
  hasAttachments: boolean,
  attachmentsReady: boolean
): Gate {
  if (socket.status !== "ready") {
    return "blocked"
  }
  if (run.status === "running") {
    return "stop"
  }
  if (draft.trim() === "" && !hasAttachments) {
    return "blocked"
  }
  if (hasAttachments && !attachmentsReady) {
    return "blocked"
  }
  return "send"
}
