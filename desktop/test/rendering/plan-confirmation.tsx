import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { ThemeProvider } from "@edu/ui/theme"
import { App } from "../../src/renderer/workspace"
import { useWorkspace } from "../../src/renderer/store"
import { useChatTabs } from "../../src/renderer/chat-tabs"
import { useTopicViews } from "../../src/renderer/topic-views"
import { SnapshotSchema } from "../../src/shared/contracts"

export async function testPlanConfirmation(root: Root, host: HTMLElement) {
  const original = window.edu
  const runnerId = crypto.randomUUID()
  const chatId = crypto.randomUUID()
  const scratchpadId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const snapshot = SnapshotSchema.parse({
    runners: [{ id: runnerId, name: "Tutor", provider: "codex", model: "test" }],
    scratchpads: [{ id: scratchpadId, title: "Fractions plan", createdAt, materials: [], planConfirmed: false,
      learning: { phase: "awaiting_plan_confirmation", outline: ["Halves"], currentSection: "", pendingQuestion: "", nextAction: "Wait for confirmation", notes: "" } }],
    chats: [{ id: chatId, runnerId, ownerScratchpadId: scratchpadId, title: "Plan confirmation", phase: "awaiting_plan_confirmation", createdAt, materials: [],
      messages: [{ id: crypto.randomUUID(), role: "assistant", content: "Confirm the fractions plan.", createdAt, scratchpadIds: [scratchpadId] }] }],
    runtime: [], connected: true,
    providers: [{ id: "codex", name: "Codex", connected: true, models: [] }],
  })
  let confirmed = false
  try {
    window.edu = { ...original!, send: async (input) => {
      if (input.chatId !== chatId || input.confirmScratchpadId !== scratchpadId || input.openedScratchpadId !== scratchpadId) throw new Error("Confirmation must retain the chat and target scratchpad")
      confirmed = true
    } }
    flushSync(() => {
      useWorkspace.getState().setSnapshot(snapshot)
      useWorkspace.getState().setError(null)
      useWorkspace.setState({ pendingMessages: [] })
      useTopicViews.getState().select(scratchpadId)
      useChatTabs.setState({ activeId: chatId, openIds: [chatId], history: [chatId] })
      root.render(<ThemeProvider><App /></ThemeProvider>)
    })
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Confirm learning plan for Fractions plan"] button')!
    if (!button || button.disabled) throw new Error("Confirmation button must be available in chat")
    flushSync(() => button.click())
    for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame)
    if (!confirmed) throw new Error("Confirmation must start the lesson")
    if (useTopicViews.getState().activeId !== scratchpadId) throw new Error("Confirming a plan must open its scratchpad")
    if (useChatTabs.getState().activeId !== chatId) throw new Error("Confirmation must preserve the active chat")
    console.log("PASS: confirming a plan opens its scratchpad and preserves the active chat")
  } finally {
    window.edu = original
    useWorkspace.setState({ pendingMessages: [] })
    flushSync(() => root.render(null))
  }
}
