// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { StudyMarkdown } from "../src/renderer/markdown"
import { TopicDirectory } from "../src/renderer/topic-directory"
import { TopicDirectoryEntrySchema } from "../src/shared/topic-directory"

const host = document.createElement("div")
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  if (!document.doctype) document.insertBefore(document.implementation.createDocumentType("html", "", ""), document.documentElement)
  document.body.append(host)
  root = createRoot(host)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.replaceChildren()
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function render(markdown: string[], titles: { title: string; anchor?: string }[]) {
  await act(async () => root.render(createElement("div", { className: "study-document" },
    createElement(StudyMarkdown, { text: markdown[0] ?? "" }),
    createElement(TopicDirectory, {
      heading: "Topic directory", currentSection: "", markdown,
      items: titles.map((entry) => TopicDirectoryEntrySchema.parse(entry)),
    }),
    createElement(StudyMarkdown, { text: markdown[1] ?? "" }),
  )))
}

function buttons() { return Array.from(host.querySelectorAll<HTMLButtonElement>("nav button")) }

test("links anchorless taught sections and scrolls past numbering and page suffix differences", async () => {
  await render(["## 1. Introduction", "## 2. **Arrays** (pg. 5–6)\n\nExplanation."], [
    { title: "Introduction" }, { title: "2. Arrays" }, { title: "3. Pointers", anchor: "pointers" },
  ])
  expect(buttons().map((button) => button.textContent)).toEqual(["Introduction", "2. Arrays"])
  const target = host.querySelectorAll(".markdown h2")[1]!
  expect(target.id).not.toBe("")
  const scroll = vi.spyOn(target, "scrollIntoView")
  buttons()[1]!.click()
  expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" })
  expect(host.querySelector("nav")?.textContent).toContain("3. Pointers")
})

test("honors explicit targets before title matches and gives repeated headings unique automatic ids", async () => {
  await render(["", '<a id="chosen"></a>\n\n## Other title\n\n## Summary\n\n## Summary\n\n## chosen'], [
    { title: "Summary", anchor: "chosen" }, { title: "Summary" }, { title: "Summary" },
  ])
  const headings = Array.from(host.querySelectorAll(".markdown h2"))
  expect(headings.map((heading) => heading.id)).toEqual(["chosen", "summary", "summary-2", "chosen-2"])
  expect(buttons()).toHaveLength(3)
  for (const [index, button] of buttons().entries()) {
    const scroll = vi.spyOn(headings[index]!, "scrollIntoView")
    button.click()
    expect(scroll).toHaveBeenCalledOnce()
  }
})

test("only links real headings, including setext and level six headings, after notes update", async () => {
  const titles = [{ title: "Future", anchor: "future" }, { title: "Deep" }, { title: "Fake" }]
  await render(["", "```md\n## Fake\n```\n\n###### Deep"], titles)
  expect(buttons().map((button) => button.textContent)).toEqual(["Deep"])
  await render(["", "Future\n------\n\n###### Deep"], titles)
  expect(buttons().map((button) => button.textContent)).toEqual(["Future", "Deep"])
})

const lecture = { id: "12345678-1234-4234-8234-123456789abc", name: "Lecture 8 - MIPS Part 3.pdf", kind: "pdf" as const }

test.each([
  "Source: [Lecture 8 PDF, p. 6](assets/Lecture 8 - MIPS Part 3.pdf#page=6)",
  "Sourced from: [Lecture 8 PDF, p. 6](assets/Lecture 8 - MIPS Part 3.pdf#page=6)",
  "Source: [Lecture 8 PDF, p. 6](<assets/Lecture 8 - MIPS Part 3.pdf#page=6>)",
])("opens a Lecture 8 citation: %s", async (text) => {
  const open = vi.fn()
  await act(async () => root.render(createElement(StudyMarkdown, {
    text,
    materials: [lecture], onOpenMaterial: open,
  })))
  const link = host.querySelector<HTMLAnchorElement>("a")
  expect(link?.textContent).toBe("Lecture 8 PDF, p. 6")
  link?.click()
  expect(open).toHaveBeenCalledWith(lecture.id)
})

test("keeps a curriculum anchor when a teaching update renames its explanation heading", async () => {
  await render(["", '<a id="overview"></a>\n\n## A machine instruction from an assembly command'], [
    { title: "1. Overview and Motivation", anchor: "overview" },
  ])
  expect(buttons()).toHaveLength(1)
  const scroll = vi.spyOn(host.querySelector(".markdown h2")!, "scrollIntoView")
  buttons()[0]!.click()
  expect(scroll).toHaveBeenCalledOnce()
})
