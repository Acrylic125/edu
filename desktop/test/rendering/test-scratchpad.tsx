import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { TestScratchpad } from "../../src/renderer/test-scratchpad"
import { TestStateSchema } from "../../src/shared/scratchpad-state"

export function testTestScratchpad(root: Root, host: HTMLElement) {
  const id = "4386c8a2-3fc8-4014-b8cc-bb765b3b59fe"
  const name = `pasted-image-${id}.png`
  const state = TestStateSchema.parse({
    type: "test", version: "19-10-2026", createdAt: new Date().toISOString(),
    name: "Vector spaces", revision: 0, goals: [], references: [], content: [],
    questions: [{
      title: "Question 2 — Addition closure of a coordinate-defined set",
      question: "Is V closed under addition?", reference: [], goals: [], threadWriters: [], mistakes: [],
      answer: `Handwritten answer in assets/${name}: u=(1,0), v=(0,1), u+v=(1,1).`,
    }],
  })
  flushSync(() => root.render(<TestScratchpad state={state} materials={[{ id, name, kind: "image" }]} />))
  const image = host.querySelector("img")
  if (image?.getAttribute("src") !== `edu-source://${id}/1`) throw new Error("Handwritten answer asset must render as a source image")
  if (host.querySelector("h2")?.textContent !== "Question 1") throw new Error("Questions must use numbered headings")
  if (host.textContent?.includes(state.questions[0].title)) throw new Error("Question subtitles must be omitted")
  if (host.textContent?.includes("Tutor notes") || host.textContent?.includes("Q2 assessment")) throw new Error("Tutor notes must not be shown")
  for (const answer of [
    `Handwritten answer in \`assets/${name}\`: u+v=(1,1).`,
    `[Handwritten answer](assets/${name})`,
    `![Handwritten answer](assets/${name})`,
    `![Handwritten answer](assets/${name})\n\n[Source](assets/${name})`,
  ]) {
    flushSync(() => root.render(<TestScratchpad state={{ ...state, questions: [{ ...state.questions[0], answer }] }} materials={[{ id, name, kind: "image" }]} />))
    if (host.querySelectorAll("img").length !== 1 || host.querySelector("img")?.getAttribute("src") !== `edu-source://${id}/1`) {
      throw new Error(`Answer must resolve its image once: ${answer}`)
    }
  }
  flushSync(() => host.querySelector<HTMLImageElement>("img")!.click())
  const preview = document.querySelector("dialog")
  if (!preview?.open || preview.querySelector("img")?.getAttribute("src") !== `edu-source://${id}/1`) throw new Error("Answer image must open a magnifiable preview")
  flushSync(() => preview.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')!.click())
  console.log("PASS: test scratchpad headings, hidden metadata, image references and magnification")

}
