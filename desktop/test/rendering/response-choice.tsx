import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { ThemeProvider } from "@edu/ui/theme"
import { App } from "../../src/renderer/workspace"
import { useWorkspace } from "../../src/renderer/store"
import { useChatTabs } from "../../src/renderer/chat-tabs"
import { useTopicViews } from "../../src/renderer/topic-views"
import { SnapshotSchema } from "../../src/shared/contracts"
import { ownTestThreads } from "./thread-fixture"

export async function testResponseChoice(root: Root, host: HTMLElement) {
  const original = window.edu
  const runnerId = crypto.randomUUID()
  const chatId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const prompt = "Would you like to proceed to 5.4 Complex Expression (1/3) or do a quick practice question on 5.3 Arithmetic Operation: Subtraction?"
  const repeated = "Would you like to proceed to **5.4 Complex Expression (1/3)** or do a **quick practice** question on **5.3 Subtraction**?"
  let selected = ""
  try {
    window.edu = { ...original!, send: async (input) => { selected = input.content } }
    for (const content of [repeated, prompt, "Correct: 4 - 9 is -5.", "Why is subtraction order important? You chose Proceed instead of Quick practice."]) {
      const snapshot = SnapshotSchema.parse({
        runners: [{ id: runnerId, name: "Tutor", provider: "codex", model: "test" }],
        scratchpads: [],
        chats: [{ id: chatId, runnerId, title: "Subtraction", phase: "awaiting_choice", createdAt, materials: [],
          messages: [{ id: crypto.randomUUID(), role: "assistant", content, createdAt, responseQuestion: { prompt, options: ["Proceed", "Quick practice"] } }] }],
        runtime: [], connected: true,
        providers: [{ id: "codex", name: "Codex", connected: true, models: [] }],
      })
      const scratchpadId = ownTestThreads(snapshot)
      flushSync(() => {
        useWorkspace.getState().setSnapshot(snapshot)
        useWorkspace.getState().setError(null)
        useWorkspace.setState({ pendingMessages: [] })
        useTopicViews.getState().select(scratchpadId)
        useChatTabs.setState({ activeId: chatId, openIds: [chatId], history: [chatId] })
        root.render(<ThemeProvider><App /></ThemeProvider>)
      })
      const fieldset = host.querySelector("fieldset")!
      const legend = fieldset?.querySelector("legend")
      if (!legend || legend.textContent !== prompt) throw new Error("Choices must retain their accessible prompt")
      const duplicated = content === repeated || content === prompt
      if (legend.classList.contains("sr-only") !== duplicated) throw new Error(`The choice prompt must appear visually once: ${content}`)
      if (fieldset.querySelectorAll("button").length !== 2) throw new Error("Both response buttons must remain available")
      if (duplicated) {
        const proceed = fieldset.querySelector<HTMLButtonElement>("button")!
        if (proceed.disabled) throw new Error("Response choices must remain enabled")
        selected = ""
        flushSync(() => proceed.click())
        for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame)
        if (selected !== "Proceed") throw new Error("Proceed must still submit the selected response")
      }
    }
    console.log("PASS: response choices show their prompt once and retain accessible, working buttons")
  } finally {
    window.edu = original
    useWorkspace.setState({ pendingMessages: [] })
    flushSync(() => root.render(null))
  }
}
