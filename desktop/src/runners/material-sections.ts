import type { WorkerJob } from "../shared/contracts"

export function materialSections(material: WorkerJob["chat"]["materials"][number]) {
  const pages = material.pages.map((page, index) => {
    const headings = page.split("\n").flatMap((line) => {
      const match = /^([1-9]\d{0,2}\.|[1-9]\d{0,2}(?:\.\d{1,3})+\.?)\s+(.+)/.exec(line.trim())
      if (!match) return []
      if (!/^(?:\p{L}|\d+\p{L}|\d+['’])/u.test(match[2]) || /[=×÷+*<>]/.test(match[2])) return []
      return [{ number: match[1].replace(/\.$/, ""), title: match[2], page: index + 1 }]
    })
    return { text: page, page: index + 1, headings }
  })
  let previous: (typeof pages)[number]["headings"][number] | undefined
  return pages.flatMap(({ text, page, headings }) => {
    if (!text.trim() || /^\s*End of (?:File|Lecture)\s*$/im.test(text)) return []
    if (/^\s*Quiz\s*$/im.test(text) && /Canvas|Quizzes tool|Access via/i.test(text)) return []
    if (headings.length) {
      // A subsection heading outranks the numbered procedure steps on the same slide.
      const depth = Math.max(...headings.map((heading) => heading.number.split(".").length))
      const candidates = headings.filter((heading) => heading.number.split(".").length === depth)
      if (candidates.length !== 1) return []
      previous = candidates[0]
      return [previous]
    }
    // Worked examples and code often omit the heading but still belong to the preceding section.
    if (previous) return [{ ...previous, page }]
    return []
  })
}
