import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { ScratchpadMismatchBanner } from "../../src/renderer/scratchpad-mismatch-banner"
import { MessageSchema, SnapshotSchema } from "../../src/shared/contracts"

export async function testScratchpadMismatchBanner(root: Root, host: HTMLElement) {
  const createdAt = new Date().toISOString()
  const topics = SnapshotSchema.parse({
    topics: ["A long scratchpad name that needs truncation", "Another scratchpad"].map((title) => ({
      id: crypto.randomUUID(), title, createdAt, materials: [], planConfirmed: true,
      learning: { phase: "ready_to_continue", outline: [], currentSection: "", pendingQuestion: "", nextAction: "", notes: "" },
    })),
    chats: [], runners: [], runtime: [], providers: [], connected: false,
  }).topics
  const request = MessageSchema.parse({ id: crypto.randomUUID(), role: "user", content: "Explain this", createdAt, topicIds: [topics[0].id] })
  const reply = MessageSchema.parse({ id: crypto.randomUUID(), role: "assistant", content: "Here is the explanation", createdAt })
  let selected = ""
  function render(references: typeof topics, currentId?: string, messages = [request, reply]) {
    flushSync(() => root.render(<ScratchpadMismatchBanner topics={references} messages={messages} currentId={currentId} onSwitch={(id) => { selected = id }} />))
  }
  render(topics, undefined, [])
  if (host.textContent) throw new Error("New threads must not show a mismatch banner")
  render(topics, undefined, [request])
  if (host.textContent) throw new Error("A pending or failed first turn must not show a mismatch banner")
  render([])
  if (host.textContent) throw new Error("Threads without scratchpad references must not show a mismatch banner")
  render(topics, topics[1].id)
  if (host.textContent) throw new Error("Viewing any referenced scratchpad must hide the banner")
  render([topics[0]], "different-scratchpad")
  const direct = host.querySelector<HTMLButtonElement>("button")!
  if (direct.textContent !== topics[0].title || !direct.classList.contains("truncate")) throw new Error("A single reference must offer a truncated scratchpad name")
  flushSync(() => direct.click())
  if (selected !== topics[0].id) throw new Error("The direct link must switch to the referenced scratchpad")
  render(topics)
  const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
  if (!trigger.textContent?.includes("Switch")) throw new Error("Multiple references must offer a Switch dropdown")
  flushSync(() => trigger.click())
  for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame)
  const menu = document.querySelector('[aria-label="Referenced scratchpads"]')!
  const items = menu.querySelectorAll<HTMLElement>('[role="menuitem"]')
  if (items.length !== 2) throw new Error("The dropdown must list every referenced scratchpad")
  flushSync(() => items[1].click())
  if (selected !== topics[1].id) throw new Error("The dropdown must switch to the selected scratchpad")
  render(topics, selected)
  if (host.textContent) throw new Error("Switching to a referenced scratchpad must dismiss the banner")
  flushSync(() => root.render(null))
  console.log("PASS: scratchpad mismatch banners hide for matches and switch single or multiple references")
}
