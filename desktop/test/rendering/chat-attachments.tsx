import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { ThemeProvider } from "@edu/ui/theme"
import { App } from "../../src/renderer/workspace"
import { useWorkspace } from "../../src/renderer/store"
import { useChatTabs } from "../../src/renderer/chat-tabs"
import { useTopicViews } from "../../src/renderer/topic-views"
import { SendSchema, SnapshotSchema } from "../../src/shared/contracts"

export async function testChatAttachments(root: Root, host: HTMLElement) {
  const original = window.prune
  try {
    for (const hasHistory of [true, false]) {
      const chatId = crypto.randomUUID()
      const runnerId = crypto.randomUUID()
      const material = { id: crypto.randomUUID(), name: "answer.png" }
      const createdAt = new Date().toISOString()
      const snapshot = SnapshotSchema.parse({
        runners: [{ id: runnerId, name: "Tutor", provider: "codex", model: "test" }],
        topics: [], runtime: [], connected: true,
        providers: [{ id: "codex", name: "Codex", connected: true, installed: true, models: [] }],
        chats: [{ id: chatId, runnerId, title: "Image test", phase: "ready_to_continue", createdAt, materials: [], messages: hasHistory
          ? [{ id: crypto.randomUUID(), role: "user", content: "Check my answer", createdAt }]
          : [] }],
      })
      const sent: Parameters<NonNullable<typeof window.prune>["send"]>[0][] = []
      window.prune = {
        ...original!,
        snapshot: async () => structuredClone(snapshot),
        pasteMaterials: async () => [material],
        importMaterials: async () => {
          snapshot.chats[0].materials.push({ ...material, id: crypto.randomUUID(), kind: "image" })
          flushSync(() => useWorkspace.getState().setSnapshot(structuredClone(snapshot)))
        },
        send: async (input) => { sent.push(SendSchema.parse(input)) },
      }
      flushSync(() => {
        useWorkspace.getState().setSnapshot(snapshot)
        useTopicViews.getState().select(undefined)
        useChatTabs.getState().select(chatId)
        root.render(<ThemeProvider><App /></ThemeProvider>)
      })
      const composer = host.querySelector('[aria-label="Chat composer"]')!
      const clipboardData = new DataTransfer()
      clipboardData.items.add(new File(["image"], material.name, { type: "image/png" }))
      composer.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData }))
      const deadline = performance.now() + 5000
      while (!host.querySelector('[aria-label="Attached images"]') || composer.querySelector<HTMLButtonElement>('[aria-label="Send message"]')?.disabled) {
        if (performance.now() > deadline) throw new Error("Pasted image did not reach the composer")
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      flushSync(() => composer.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.click())
      while (!sent.length && !useWorkspace.getState().error) {
        if (performance.now() > deadline) throw new Error("Image-only message was not sent")
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      if (useWorkspace.getState().error) throw new Error(useWorkspace.getState().error!)
      const expected = hasHistory ? "" : "Help me understand the attached materials: answer.png."
      if (sent[0].content !== expected) throw new Error(`Image-only message with history=${hasHistory}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(sent[0].content)}`)
      if (hasHistory && !sent[0].materialIds?.length) throw new Error("Image-only follow-ups must identify the attachment")
      snapshot.chats[0].messages.push({ id: crypto.randomUUID(), role: "user", content: sent[0].content,
        materialIds: snapshot.chats[0].materials.map((item) => item.id), createdAt, topicIds: [] })
      flushSync(() => useWorkspace.getState().setSnapshot(structuredClone(snapshot)))
      if (!composer.querySelector<HTMLButtonElement>('[aria-label="Send message"]')?.disabled) throw new Error("Previously sent attachments must not enable an empty message")
      flushSync(() => root.render(null))
    }
    console.log("PASS: image-only messages add the learning prompt only before the first turn")
  } finally {
    window.prune = original
    flushSync(() => root.render(null))
  }
}
