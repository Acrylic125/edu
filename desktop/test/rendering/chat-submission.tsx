import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { ThemeProvider } from "@edu/ui/theme"
import { App } from "../../src/renderer/workspace"
import { useWorkspace } from "../../src/renderer/store"
import { useChatTabs } from "../../src/renderer/chat-tabs"
import { useTopicViews } from "../../src/renderer/topic-views"
import { MessageSchema, PublicChatSchema, SnapshotSchema } from "../../src/shared/contracts"
import { $getRoot, getNearestEditorFromDOMNode } from "lexical"

async function waitFor(check: () => boolean, description: string) {
  const deadline = performance.now() + 5000
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${description}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export async function testChatSubmission(root: Root, host: HTMLElement) {
  const original = window.edu
  try {
    const scenarios = ["existing", "new-chat", "new-topic"].flatMap((mode) =>
      [false, true].flatMap((fails) => [false, true].map((savedBeforeFinish) => ({ mode, fails, savedBeforeFinish }))),
    )
    for (const { mode, fails, savedBeforeFinish } of scenarios) {
      const chatId = crypto.randomUUID()
      const runnerId = crypto.randomUUID()
      const snapshot = SnapshotSchema.parse({
        runners: [{ id: runnerId, name: "Tutor", provider: "codex", model: "test" }],
        topics: [], runtime: [], connected: true,
        providers: [{ id: "codex", name: "Codex", connected: true, models: [] }],
        chats: [],
      })
      const chat = PublicChatSchema.parse({ id: chatId, runnerId, title: "Submission test", phase: "ready_to_continue", createdAt: new Date().toISOString(), materials: [], messages: [] })
      if (mode === "existing") snapshot.chats.push(chat)
      let finish = () => {}
      let sent = ""
      let sentId = ""
      window.edu = {
        ...original!,
        createChat: async () => {
          snapshot.chats.push(chat)
          flushSync(() => useWorkspace.getState().setSnapshot(structuredClone(snapshot)))
          return chatId
        },
        send: (input) => {
          sent = input.content
          sentId = input.messageId ?? ""
          return new Promise<void>((resolve, reject) => {
            finish = () => {
              if (fails) reject(new Error("Send failed"))
              else resolve()
            }
          })
        },
      }
      flushSync(() => {
        useWorkspace.getState().setSnapshot(snapshot)
        useWorkspace.getState().setError(null)
        useWorkspace.setState({ pendingMessages: [] })
        useTopicViews.getState().select(undefined)
        useChatTabs.setState({ activeId: "new", openIds: [], history: [] })
        if (mode === "existing") useChatTabs.getState().select(chatId)
        if (mode === "new-chat") useChatTabs.getState().select("new")
        root.render(<ThemeProvider><App /></ThemeProvider>)
      })
      const editor = () => {
        let label = "Message this chat"
        if (mode === "new-topic" && !sent) label = "Message your tutor"
        return host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!
      }
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
      getNearestEditorFromDOMNode(editor())!.update(() => {
        $getRoot().selectEnd().insertText("First message")
      }, { discrete: true })
      const sendButton = () => editor().closest('[aria-label$="composer"]')!.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!
      await waitFor(() => !sendButton().disabled, `${mode}: enabled send button (${editor().textContent})`)
      flushSync(() => sendButton().click())
      if (editor().textContent?.trim()) throw new Error("Composer must clear before chat creation or sending")
      if (!host.querySelector('[data-message-role="user"]')?.textContent?.includes("First message")) {
        throw new Error("The submitted user message must be visible before chat creation or sending")
      }
      await waitFor(() => sent.length > 0, `${mode}: send call`)
      if (editor().textContent?.trim()) throw new Error("Composer must clear before the pending send resolves")
      if (sent !== "First message") throw new Error("Submission must retain the original message")
      if (!sentId) throw new Error("Submission must send the pending message ID to the backend")
      if (!host.querySelector('[data-message-role="user"]')?.textContent?.includes("First message")) {
        throw new Error("The submitted user message must be visible while send is pending")
      }
      getNearestEditorFromDOMNode(editor())!.update(() => {
        $getRoot().selectEnd().insertText("Next draft")
      }, { discrete: true })
      await waitFor(() => editor().textContent === "Next draft", `${mode}: new draft`)
      function publishMessage() {
        chat.messages.push(MessageSchema.parse({ id: sentId, role: "user", content: sent, createdAt: new Date().toISOString() }))
        flushSync(() => useWorkspace.getState().setSnapshot(structuredClone(snapshot)))
        if (host.querySelectorAll('[data-message-role="user"]').length !== 1) throw new Error("Saved messages must replace the pending bubble without duplicates")
        if (useWorkspace.getState().pendingMessages.length) throw new Error("Snapshot acknowledgement must remove the pending state")
      }
      if (savedBeforeFinish) publishMessage()
      finish()
      await waitFor(() => !host.querySelector('[aria-label="Sending message"]'), `${mode}: finished submission`)
      let expected = "Next draft"
      if (fails && !savedBeforeFinish) expected = "First message\n\nNext draft"
      if (editor().innerText !== expected) throw new Error(`Submission lost draft text: ${JSON.stringify(editor().innerText)}`)
      if (!fails && !savedBeforeFinish) {
        if (host.querySelectorAll('[data-message-role="user"]').length !== 1) throw new Error("Pending bubble must stay visible after send resolves until the snapshot arrives")
        publishMessage()
      }
      if (fails && !savedBeforeFinish && host.querySelector('[data-message-role="user"]')) throw new Error("Failed unsaved messages must return to the draft")
      flushSync(() => root.render(null))
    }
    console.log("PASS: chat submission shows immediately, reconciles snapshots without duplicates, preserves edits, and restores only unsaved failures")
  } finally {
    window.edu = original
    useWorkspace.setState({ pendingMessages: [] })
    flushSync(() => root.render(null))
  }
}
