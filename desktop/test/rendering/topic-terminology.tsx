import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { StudyMarkdown } from "../../src/renderer/markdown"
import type { TopicTerm } from "../../src/renderer/topic-terminology"

export async function testTopicTerminology(root: Root, host: HTMLElement) {
  const terms: TopicTerm[] = [{ type: "term", id: "slope", term: "slope", meaning: "Rate of **change**." }]
  const text = "The Slope increases.\n\n## Topic terminology\n\n| Term | Meaning |\n|---|---|\n| slope | Rate of change. |"
  function render(terminology: TopicTerm[]) {
    flushSync(() => root.render(<StudyMarkdown text={text} terminology={terminology} />))
  }
  async function waitFor(label: string, check: () => boolean) {
    const deadline = performance.now() + 2000
    while (!check()) {
      if (performance.now() > deadline) throw new Error(`Terminology popup: ${label}`)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  render(terms)
  const mark = host.querySelector<HTMLElement>("mark")!
  if (host.querySelectorAll("mark").length !== 1 || mark.textContent !== "Slope") throw new Error("Only prose occurrences should be highlighted")

  await new Promise(requestAnimationFrame)
  const bounds = mark.getBoundingClientRect()
  mark.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }))
  mark.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: bounds.x + 2, clientY: bounds.y + 2 }))
  await waitFor("hover opens a formatted definition", () => document.querySelector('[role="tooltip"] strong')?.textContent === "change")
  if (host.contains(document.querySelector('[role="tooltip"]'))) throw new Error("Definition popup must escape document clipping")
  flushSync(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  await waitFor("Escape dismisses the definition", () => !document.querySelector('[role="tooltip"]'))

  mark.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }))
  mark.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, relatedTarget: document.body }))
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
  flushSync(() => mark.focus())
  await waitFor("keyboard focus opens the definition", () => !!document.querySelector('[role="tooltip"]'))
  if (!mark.getAttribute("aria-describedby")) throw new Error("Keyboard focus must expose the definition to assistive technology")
  render([{ ...terms[0], meaning: "Updated definition." }])
  await waitFor("an open definition updates", () => document.querySelector('[role="tooltip"]')?.textContent?.includes("Updated definition.") === true)
  if (host.querySelector("mark") !== mark) throw new Error("Definition edits should preserve highlighted text and focus")

  render([{ ...terms[0], term: "increases" }])
  if (host.querySelector("mark")?.textContent !== "increases") throw new Error("Renamed terms must update highlights")
  render([])
  if (host.querySelector("mark")) throw new Error("Removed terms must remove highlights")
  flushSync(() => root.render(null))
  console.log("PASS: terminology highlights show current definitions on hover and keyboard focus")
}
