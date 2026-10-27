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
    topics: [], runtime: [], connected: true,
    providers: [{ id: "codex", name: "Codex", connected: true, installed: true, models: [] }],
    chats: [{ id: chatId, runnerId, title: "Clipboard test", phase: "ready_to_continue", createdAt: new Date().toISOString(), materials: [], messages: [] }],
  })
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
      useTopicViews.getState().select(undefined)
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
  } finally {
    finishCopy()
    await new Promise(requestAnimationFrame)
    window.edu = original
    flushSync(() => root.render(null))
  }
}
