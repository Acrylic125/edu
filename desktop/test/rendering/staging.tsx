import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { ThemeProvider } from "@edu/ui/theme"
import { App } from "../../src/renderer/workspace"
import { initializeWorkspace, useWorkspace } from "../../src/renderer/store"
import { useChatTabs } from "../../src/renderer/chat-tabs"
import { stagingId, useTopicViews } from "../../src/renderer/topic-views"
import { MessageSchema, SnapshotSchema, type Snapshot } from "../../src/shared/contracts"
import { ownTestThreads } from "./thread-fixture"

async function settle() {
  for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame)
}

async function menuFor(element: HTMLElement) {
  flushSync(() => element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 })))
  await settle()
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

export async function testStaging(root: Root, host: HTMLElement) {
  const original = window.edu
  const startTransition = document.startViewTransition
  let transitions = 0
  const runnerId = crypto.randomUUID()
  const snapshot = SnapshotSchema.parse({
    runners: [{ id: runnerId, name: "Tutor", provider: "codex", model: "test" }],
    scratchpads: [], runtime: [], connected: true,
    providers: [{ id: "codex", name: "Codex", connected: true, installed: true, models: [] }],
    chats: ["First staged thread", "Second staged thread", "Owned thread"].map((title) => ({
      id: crypto.randomUUID(), runnerId, title, scratchpadRequested: title !== "Owned thread", phase: "ready_to_continue", createdAt: new Date().toISOString(), materials: [],
      messages: [MessageSchema.parse({ id: crypto.randomUUID(), role: "assistant", content: "What would you like to learn?", createdAt: new Date().toISOString() })],
    })),
  })
  const ownerId = ownTestThreads(snapshot)
  snapshot.chats[0].ownerScratchpadId = undefined
  snapshot.chats[1].ownerScratchpadId = undefined
  const firstId = snapshot.chats[0].id
  const secondId = snapshot.chats[1].id
  const ownedId = snapshot.chats[2].id
  snapshot.chats[2].movedRequests.push({
    messageId: crypto.randomUUID(), messageIndex: 1, chatId: secondId, scratchpadId: ownerId,
  })
  let deleted = ""
  let receiveSnapshot = (_snapshot: Snapshot) => {}
  window.edu = {
    ...original!, snapshot: async () => structuredClone(snapshot),
    subscribe: (listener) => { receiveSnapshot = listener; return () => {} },
    subscribeRuntime: () => () => {},
    deleteStagedChat: async (id) => {
      deleted = id
      snapshot.chats = snapshot.chats.filter((chat) => chat.id !== id)
      flushSync(() => receiveSnapshot(structuredClone(snapshot)))
    },
  }
  if (startTransition) document.startViewTransition = (options) => {
    transitions++
    return startTransition.call(document, options)
  }
  try {
    await initializeWorkspace()
    flushSync(() => {
      useTopicViews.getState().select(ownerId)
      useChatTabs.getState().select(ownedId)
      root.render(<ThemeProvider><App /></ThemeProvider>)
    })
    await settle()
    const movedNotice = Array.from(host.querySelectorAll('div')).find((element) => element.classList.contains('text-yellow-700') && element.textContent?.startsWith('Moved request to'))
    if (!movedNotice) throw new Error("Moved requests must leave a yellow notice in the source thread")
    const destination = movedNotice.querySelector('button')!
    if (destination.textContent?.trim() !== "Thread owner") throw new Error("The moved request must resolve its scratchpad title by ID")
    const renamed = "Renamed scratchpad with a very long title that should be truncated in the moved request notice"
    snapshot.scratchpads.find((scratchpad) => scratchpad.id === ownerId)!.title = renamed
    flushSync(() => receiveSnapshot(structuredClone(snapshot)))
    await settle()
    if (destination.textContent?.trim() !== renamed || destination.title !== renamed) throw new Error("Moved request notices must follow scratchpad renames")
    if (!destination.classList.contains("truncate") || !destination.classList.contains("max-w-48")) throw new Error("Long destination names must use a bounded, truncated label")
    flushSync(() => destination.click())
    await settle()
    if (useTopicViews.getState().activeId !== ownerId) throw new Error("Moved request links must open the destination scratchpad by ID")
    let menu = await menuFor(host.querySelector<HTMLElement>('[role="tab"][title="Owned thread"]')!)
    if (menu.some((item) => item.textContent?.includes("Delete"))) throw new Error("Owned threads must not offer Delete")
    flushSync(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    await settle()
    const navigation = host.querySelector('nav[aria-label="Your scratchpads"]')!
    const entries = Array.from(navigation.querySelectorAll<HTMLButtonElement>('button[aria-current], button')).filter((item) => item.textContent?.includes("thread"))
    const firstEntry = entries.find((item) => item.textContent?.startsWith("First staged thread"))!
    if (!firstEntry?.classList.contains("bg-amber-500/8") || firstEntry.querySelector('[data-slot="badge"]')?.textContent !== "Staging") throw new Error("Staged entries must use a muted amber background and a Staging badge below the title")
    if (!navigation.firstElementChild?.textContent?.includes("First staged thread")) throw new Error("Staged threads must be pinned above scratchpads")
    flushSync(() => firstEntry.click())
    await settle()
    const staging = host.querySelector<HTMLElement>('section[aria-label="Staging"]')!
    if (!staging || !staging.classList.contains("max-w-[850px]") || !staging.classList.contains("mx-auto")) throw new Error("Staging chat must be centered at the New Scratchpad width")
    if (useChatTabs.getState().activeId !== firstId) throw new Error("A staged sidebar entry must select its thread")
    if (staging.querySelector('[role="tablist"]')) throw new Error("An unfinished scratchpad must not have thread tabs")
    if (!staging.querySelector('[aria-label="Delete staging scratchpad"]')) throw new Error("An unfinished scratchpad must have its own Delete action")
    const pendingNotice = staging.querySelector('[aria-label="Pending scratchpad creation"]')
    if (!pendingNotice?.parentElement?.querySelector('[aria-label="Chat composer"]')) throw new Error("The pending-creation notice and Delete link must sit immediately above the composer")
    if (staging.textContent?.includes("Second staged thread")) throw new Error("An unfinished scratchpad must show only its own conversation")
    menu = await menuFor(firstEntry)
    if (menu.some((item) => /Threads|Archive/.test(item.textContent ?? ""))) throw new Error("Staging sidebar menus must omit View Threads and Archive")
    const remove = menu.find((item) => item.textContent === "Delete")
    if (!remove?.classList.contains("text-destructive")) throw new Error("Staging Delete must be destructive")
    flushSync(() => remove.click())
    await settle()
    if (deleted !== firstId || !snapshot.chats.some((chat) => chat.id === secondId)) throw new Error("Delete must affect only the selected staged thread")
    const newScratchpad = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "New scratchpad")!
    flushSync(() => newScratchpad.click())
    await settle()
    if (!host.querySelector('h1')?.textContent?.includes("learn today")) throw new Error("New Scratchpad must restore the default welcome screen")
    if (host.querySelector('section[aria-label="Staging"]') || host.querySelector('[role="tablist"]')) throw new Error("New Scratchpad must not contain staging or tabs")
    const secondEntry = Array.from(host.querySelectorAll<HTMLButtonElement>('nav[aria-label="Your scratchpads"] button')).find((button) => button.textContent?.startsWith("Second staged thread"))!
    flushSync(() => secondEntry.click())
    await settle()
    if (useChatTabs.getState().activeId !== secondId) throw new Error("Selecting another unfinished scratchpad must open its own conversation")
    if (host.querySelector('[role="tablist"]')) throw new Error("Switching unfinished scratchpads must not reveal tabs")
    const promoted = structuredClone(snapshot)
    promoted.chats.find((chat) => chat.id === secondId)!.ownerScratchpadId = ownerId
    const before = transitions
    receiveSnapshot(promoted)
    const deadline = performance.now() + 3000
    while (useTopicViews.getState().activeId !== ownerId) {
      if (performance.now() > deadline) throw new Error("Promotion did not open the owning scratchpad")
      await new Promise(requestAnimationFrame)
    }
    await settle()
    if (useChatTabs.getState().activeId !== secondId) throw new Error("Promotion must retain the selected thread")
    if (host.querySelector('section[aria-label="Staging"]')) throw new Error("Promoted threads must leave Staging")
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches && transitions <= before) throw new Error("Promotion must use the workspace transition")
    menu = await menuFor(host.querySelector<HTMLElement>('[role="tab"][title="Second staged thread"]')!)
    if (menu.some((item) => item.textContent?.includes("Delete"))) throw new Error("Promotion must remove the staging-only Delete action")
    console.log("PASS: unfinished scratchpads have one conversation without tabs; New Scratchpad restores its welcome screen; promotion opens the document with a transition")
  } finally {
    document.startViewTransition = startTransition
    window.edu = original
    flushSync(() => root.render(null))
  }
}
