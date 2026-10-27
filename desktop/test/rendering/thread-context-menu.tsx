import { ownTestThreads } from "./thread-fixture"
import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { ThemeProvider } from "@edu/ui/theme"
import { App } from "../../src/renderer/workspace"
import { useWorkspace } from "../../src/renderer/store"
import { useChatTabs } from "../../src/renderer/chat-tabs"
import { useTopicViews } from "../../src/renderer/topic-views"
import { SnapshotSchema } from "../../src/shared/contracts"

export async function testThreadContextMenu(root: Root, host: HTMLElement) {
  const original = window.edu
  const chatId = crypto.randomUUID()
  const runnerId = crypto.randomUUID()
  const snapshot = SnapshotSchema.parse({
    runners: [{ id: runnerId, name: "Tutor", provider: "codex", model: "test" }],
    scratchpads: [], runtime: [], connected: true,
    providers: [{ id: "codex", name: "Codex", connected: true, installed: true, models: [] }],
    chats: [{ id: chatId, runnerId, title: "Clipboard test", phase: "ready_to_continue", createdAt: new Date().toISOString(), materials: [], messages: [] }],
  })
  const ownerId = ownTestThreads(snapshot)
  const otherId = crypto.randomUUID()
  const otherChatId = crypto.randomUUID()
  snapshot.scratchpads.push({ ...snapshot.scratchpads[0], id: otherId, title: "Referenced scratchpad" })
  snapshot.chats[0].messages.push({ id: crypto.randomUUID(), role: "user", content: "Reference", createdAt: new Date().toISOString(), scratchpadIds: [otherId] })
  snapshot.chats.push({ ...snapshot.chats[0], id: otherChatId, title: "Other thread", ownerScratchpadId: otherId, messages: [] })
  let copied = ""
  let finishCopy = () => {}
  window.edu = {
    ...original!,
    copyText: (text) => {
      copied = text
      return new Promise<void>((resolve) => { finishCopy = resolve })
    },
  }
  try {
    flushSync(() => {
      useWorkspace.getState().setSnapshot(snapshot)
      useWorkspace.getState().setError(null)
      useTopicViews.getState().select(ownerId)
      useChatTabs.getState().select(chatId)
      root.render(<ThemeProvider><App /></ThemeProvider>)
    })
    const tab = host.querySelector<HTMLButtonElement>('[role="tab"][title="Clipboard test"]')!
    flushSync(() => tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 30 })))
    await new Promise(requestAnimationFrame)
    const copy = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent?.includes("Copy Thread ID"))
    if (!copy) throw new Error("Thread context menu did not open")
    flushSync(() => copy.click())
    await new Promise(requestAnimationFrame)
    if (copied !== chatId) throw new Error("Copy Thread ID must copy the selected thread's ID")
    if (host.textContent?.includes("Finishing your action…")) throw new Error("Copy Thread ID flashes the global busy banner and shifts the workspace")
    console.log("PASS: Copy Thread ID copies without flashing the global busy banner")
    if (host.querySelector('[role="tab"][title="Other thread"]')) throw new Error("Only owned threads may appear in the tab strip")
    flushSync(() => useTopicViews.getState().select(otherId))
    if (host.querySelector('[role="tab"][title="Clipboard test"]')) throw new Error("Referencing a scratchpad must not give it ownership of the thread")
    if (!host.querySelector('[role="tab"][title="Other thread"]')) throw new Error("Switching scratchpads must show the new owner's threads")
    flushSync(() => useTopicViews.getState().select(undefined))
    if (host.querySelector('[role="tablist"]') || host.querySelector('[aria-label="Chat composer"]')) throw new Error("New Scratchpad must not contain a threads section")
    flushSync(() => useTopicViews.getState().select(ownerId))
    for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame)
    if (!host.querySelector('[role="tab"][title="Clipboard test"][aria-selected="true"]')) throw new Error("Returning to a scratchpad must restore its selected thread")
    console.log("PASS: scratchpad threads follow ownership, preserve selection, and stay hidden on New Scratchpad")
  } finally {
    finishCopy()
    await new Promise(requestAnimationFrame)
    window.edu = original
    flushSync(() => root.render(null))
  }
}
