import { ownTestThreads } from "./thread-fixture"
import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { ThemeProvider } from "@edu/ui/theme"
import { App } from "../../src/renderer/workspace"
import { useWorkspace } from "../../src/renderer/store"
import { useChatTabs } from "../../src/renderer/chat-tabs"
import { useTopicViews } from "../../src/renderer/topic-views"
import { messageClipboardHtml } from "../../src/shared/message-clipboard"
import { SnapshotSchema } from "../../src/shared/contracts"
import { TopicMentionInput } from "../../src/renderer/topic-mention-input"

export async function testPastedTopicMentions(root: Root, host: HTMLElement) {
  const id = "a0d22c91-1058-4182-a0d5-19a72ddc40a8"
  const title = "Lecture 6: MIPS Part 1"
  const content = `/new-test Test me on [@${title}](edu-topic://${id})`
  let value = ""
  flushSync(() => root.render(<TopicMentionInput
    label="Mention paste test"
    initialValue=""
    scratchpads={[{ id, title, archived: false }]}
    placeholder=""
    className=""
    onChange={(next) => { value = next }}
    onSubmit={() => {}}
  />))
  const editor = host.querySelector<HTMLElement>('[contenteditable="true"]')!
  editor.focus()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const clipboardData = new DataTransfer()
  clipboardData.setData("text/plain", content)
  clipboardData.setData("text/html", messageClipboardHtml(content, []))
  editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (editor.textContent !== `/new-test Test me on @${title}` || editor.querySelector(`[title="@${title}"]`)?.textContent !== `@${title}`) {
    throw new Error(`Pasting a copied message must restore its @ mention chip; received ${editor.textContent}`)
  }
  if (value !== content) throw new Error("Pasting a mention must preserve its topic link when sent")
  flushSync(() => root.render(null))
  console.log("PASS: pasting copied messages restores @ mention chips and preserves topic links")
}

export async function testMessageClipboard(root: Root, host: HTMLElement) {
  const original = window.edu
  for (const sameChat of [true, false]) {
    const chatId = crypto.randomUUID()
    const runnerId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const materials = ["Lecture 6.pdf", "Lecture 6.pptx"].map((name) => ({ id: crypto.randomUUID(), name, kind: "text" }))
    const content = "Help me work with the attached materials: Lecture 6.pdf, Lecture 6.pptx."
    const snapshot = SnapshotSchema.parse({
      runners: [{ id: runnerId, name: "Tutor", provider: "codex", model: "test" }],
      scratchpads: [], runtime: [], connected: true,
      providers: [{ id: "codex", name: "Codex", connected: true, installed: true, models: [] }],
      chats: [{ id: chatId, runnerId, title: "Copy attachments", phase: "ready_to_continue", createdAt, materials,
        messages: [{ id: crypto.randomUUID(), role: "user", content, createdAt, materialIds: materials.map((item) => item.id) }] }],
    })
    const ownerId = ownTestThreads(snapshot)
    const targetId = crypto.randomUUID()
    if (!sameChat) snapshot.chats.push({ ...snapshot.chats[0], id: targetId, messages: [], materials: [] })
    const reused = materials.map((item) => ({ id: crypto.randomUUID(), name: item.name }))
    let copied = ""
    const expectedText = "Help me work with the attached materials."
    const sent: Parameters<NonNullable<typeof window.edu>["send"]>[0][] = []
    try {
      window.edu = { ...original!,
        removeChatMaterial: async (id, materialId) => {
          const target = snapshot.chats.find((item) => item.id === id)!
          target.materials = target.materials.filter((item) => item.id !== materialId)
          flushSync(() => useWorkspace.getState().setSnapshot(structuredClone(snapshot)))
        },
        reuseMaterials: async (ids) => {
          if (ids.join() !== materials.map((item) => item.id).join()) throw new Error("Paste requested the wrong sources")
          return reused
        },
        importMaterials: async (owner, ids = []) => {
          snapshot.chats.find((item) => item.id === owner.id)!.materials.push(...reused.filter((item) => ids.includes(item.id)).map((item) => ({ ...item, kind: "text" as const })))
          flushSync(() => useWorkspace.getState().setSnapshot(structuredClone(snapshot)))
        }, snapshot: async () => structuredClone(snapshot), send: async (input) => { sent.push(input) }, copyText: async (...args) => { copied = JSON.stringify(args) } }
      flushSync(() => {
        useWorkspace.getState().setSnapshot(snapshot)
        useTopicViews.getState().select(ownerId)
        useChatTabs.getState().select(chatId)
        root.render(<ThemeProvider><App /></ThemeProvider>)
      })
      flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Copy message"]')!.click())
      for (const material of materials) {
        if (!copied.includes(material.id)) throw new Error("Copying a message omitted its attachments")
      }
      if (!copied.includes(expectedText) || copied.includes("Lecture 6.pdf")) throw new Error("Copy must omit generated attachment filenames")
      if (!sameChat) flushSync(() => useChatTabs.getState().select(targetId))
      const composer = host.querySelector('[aria-label="Chat composer"]')!
      const clipboardData = new DataTransfer()
      clipboardData.setData("text/plain", expectedText)
      clipboardData.setData("text/html", messageClipboardHtml(expectedText, materials.map((item) => item.id)))
      const editor = composer.querySelector<HTMLElement>('[contenteditable="true"]')!
      editor.focus()
      await new Promise((resolve) => setTimeout(resolve, 0))
      editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }))
      const deadline = performance.now() + 3000
      while (!host.querySelector('[aria-label="Attached materials"]')) {
        if (performance.now() > deadline) throw new Error("Pasting the copied message did not restore attachments")
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      for (const material of materials) {
        if (!Array.from(host.querySelectorAll('[aria-label="Attached materials"] [title]')).some((element) => element.getAttribute("title") === material.name)) throw new Error(`Missing pasted attachment ${material.name}`)
      }
      const remove = composer.querySelector<HTMLButtonElement>(`[aria-label="Remove ${materials[0].name}"]`)
      if (!remove) throw new Error("Sidebar attachments need a remove button")
      flushSync(() => remove.click())
      while (composer.querySelector(`[aria-label="Remove ${materials[0].name}"]`) || composer.querySelector<HTMLButtonElement>('[aria-label="Send message"]')?.disabled) {
        if (performance.now() > deadline) throw new Error("Attachment removal did not finish")
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      if (composer.querySelector(`[aria-label="Remove ${materials[0].name}"]`)) throw new Error("Removed attachment remained in the composer")
      flushSync(() => composer.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.click())
      while (!sent.length) {
        if (performance.now() > deadline) throw new Error("Reattached materials could not be sent")
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      if (sent[0].content !== expectedText) throw new Error("Pasting changed the copied message text")
      if (sameChat && sent[0].materialIds?.join() !== materials.slice(1).map((item) => item.id).join()) throw new Error("Sending dropped copied attachments")
      if (!sameChat && snapshot.chats[1].materials.length !== 1) throw new Error("Attachments were not imported into the destination chat")
      console.log("PASS: copying and pasting a message restores and resends its PDF and PowerPoint attachments")
    } finally {
      window.edu = original
      flushSync(() => root.render(null))
    }
  }
}
