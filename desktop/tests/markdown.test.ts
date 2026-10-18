import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { visualizationInstructions, parseVisualizationSettings } from "../src/shared/visualization"
import { prepareVisualizationMarkdown } from "../src/renderer/visualization/markdown"
import { StudyMarkdown } from "../src/renderer/markdown"

const material = {
  id: "12345678-1234-4234-8234-123456789abc",
  name: "Lecture 6 - MIPS Part 1 (full set).pdf",
  kind: "pdf" as const,
}

vi.mock("../src/renderer/mermaid-diagram", () => ({
  MermaidDiagram: ({ definition }: { definition: string }) =>
    createElement("div", { "data-diagram": definition }),
}))

vi.mock("../src/renderer/visualization/plotly-visualization", () => ({
  PlotlyVisualization: ({ source, pending }: { source: string; pending: boolean }) =>
    createElement("figure", { "aria-label": pending ? "Preparing visualization" : "Plot", "data-source": source }),
}))

function render(text: string) {
  return renderToStaticMarkup(createElement(StudyMarkdown, { text }))
}

describe("study Markdown", () => {
  it("renders visualization blocks without changing payload strings or surrounding Markdown", () => {
    const source = String.raw`<visualization settings='{"type":"Plotly.js","data":[{"type":"scatter","x":[0],"y":[1],"text":["\\(x\\) Sourced from: Lecture 6.pdf, pg. 2 <x> />"]}]}' />`
    const html = renderToStaticMarkup(createElement(StudyMarkdown, { text: `Before **plot**\n\n${source}\n\nAfter`, materials: [material] }))
    expect(html).toContain('<figure aria-label="Plot"')
    expect(html).toContain('Before <strong>plot</strong>')
    expect(html).toContain('<p>After</p>')
    expect(html).not.toContain('<pre>')
    expect(html).not.toContain('edu-material://')
    expect(html).toContain('Sourced from: Lecture 6.pdf, pg. 2 &lt;x&gt; /&gt;')
    expect(render("<visualization settings='{\n")).toContain('aria-label="Preparing visualization"')
    expect(render(`\`\`\`html\n${source}\n\`\`\``)).not.toContain('<figure')
    expect(render('<script>alert(1)</script>')).not.toContain('<script>')
  })

  it("renders both canonical agent examples with valid settings", () => {
    const examples = prepareVisualizationMarkdown(visualizationInstructions).blocks
    expect(examples).toHaveLength(2)
    for (const block of examples) {
      const match = /settings='([\s\S]*)' \/>/.exec(block.source)
      expect(match).not.toBeNull()
      expect(parseVisualizationSettings(match![1]).success).toBe(true)
      expect(render(block.source)).toContain('<figure aria-label="Plot"')
    }
  })

  it.each([
    String.raw`The limit is \(\lim_{x\to1} f(x)=2\).`,
    String.raw`The limit is $\lim_{x\to1} f(x)=2$.`,
  ])("renders inline LaTeX: %s", (text) => {
    const html = render(text)
    expect(html).toContain('class="katex"')
    expect(html).not.toContain('class="katex-display"')
    expect(html).not.toContain("katex-error")
  })

  it.each([
    String.raw`Consider \[ f(x)=\frac{x^2-1}{x-1},\qquad x\ne1. \] Then factor.`,
    "$$\n" + String.raw`f(x)=\frac{x^2-1}{x-1}` + "\n$$",
  ])("renders display LaTeX: %s", (text) => {
    const html = render(text)
    expect(html).toContain('class="katex-display"')
    expect(html).not.toContain("katex-error")
  })

  it("preserves inline and fenced code, including incomplete streamed fences", () => {
    const expression = String.raw`\(x^2\) and \[x+1\]`
    for (const text of [
      `\`${expression}\``,
      `\`\`${expression}\`\``,
      `\`\`\`tex\n${expression}\n\`\`\``,
      `~~~~tex\n${expression}\n~~~~~`,
      `\`\`\`tex\n${expression}`,
    ]) {
      const html = render(text)
      expect(html).not.toContain('class="katex"')
      expect(html).toContain(expression)
    }
  })

  it("keeps incomplete or invalid LaTeX readable", () => {
    expect(render(String.raw`Still streaming \(\frac{x`)).toContain("Still streaming")
    expect(render(String.raw`\(\invalidcommand{x}\)`)).toContain("invalidcommand")
  })

  it("renders Mermaid fences outside preformatted code", () => {
    const html = render("```mermaid\ngraph TD\n  A --> B\n```")
    expect(html).toContain('data-diagram="graph TD\n  A --&gt; B"')
    expect(html).not.toContain("<pre>")
    expect(render("```ts\nconst x = 1\n```")).toContain('<pre><code class="hljs language-ts">')
  })

  it("keeps Markdown lists, tables, and links working", () => {
    const html = render("- First\n- Second\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n[Docs](https://example.com)")
    expect(html).toContain("<ul>")
    expect(html).toContain("<table>")
    expect(html).toContain('href="https://example.com"')
  })

  it.each([
    "*Sourced from: Lecture 6.pdf, pg. 6-7.*",
    "Sourced from: [Lecture 6.pdf, pg. 6-7.](<assets/Lecture 6.pdf#page=6>)",
    "Sourced from: [Lecture 6.pdf, pg. 6-7.](<assets/Lecture 6 - MIPS Part 1 (full set).pdf#page=6>)",
    `Sourced from: [Lecture 6.pdf, pg. 6-7.](edu-material://${material.id}/6)`,
  ])("renders lecture citations as clickable source links: %s", (text) => {
    const html = renderToStaticMarkup(createElement(StudyMarkdown, {
      text,
      materials: [material],
      onOpenMaterial: vi.fn(),
    }))
    expect(html).toContain(`<a href="edu-material://${material.id}/6"`)
    expect(html).toContain("Lecture 6.pdf, pg. 6-7")
  })

  it.each(["pdf", "pptx", "txt"])("renders Materials links for %s files", (extension) => {
    const name = `Lecture 4A - Pointers and Functions.${extension}`
    const html = renderToStaticMarkup(createElement(StudyMarkdown, {
      text: `## Materials\n\n- [${name}](<assets/${name}>), pages 1-15.`,
      materials: [{ ...material, name }],
      onOpenMaterial: vi.fn(),
    }))
    expect(html).toContain(`<a href="edu-material://${material.id}/1">${name}</a>`)
    expect(html).toContain(", pages 1-15.")
  })

  it("preserves source images returned by the tutor", () => {
    const html = render(`![ISA diagram](prune-source://${material.id}/6)`)
    expect(html).toContain(`src="prune-source://${material.id}/6"`)
    expect(html).toContain('alt="ISA diagram"')
  })

  it("leaves citations inside code examples unchanged", () => {
    for (const text of [
      "`Sourced from: Lecture 6.pdf, pg. 6-7.`",
      "```text\nSourced from: Lecture 6.pdf, pg. 6-7.\n```",
      "~~~text\nSourced from: Lecture 6.pdf, pg. 6-7.\n~~~",
      "```text\nSourced from: Lecture 6.pdf, pg. 6-7.",
      "Sourced from: `Lecture 6.pdf, pg. 6-7.`",
      "    Sourced from: Lecture 6.pdf, pg. 6-7.",
    ]) {
      const html = renderToStaticMarkup(createElement(StudyMarkdown, { text, materials: [material], onOpenMaterial: vi.fn() }))
      expect(html).not.toContain("edu-material://")
    }
  })

  it("does not invent source links for missing or ambiguous materials", () => {
    for (const materials of [[], [material, { ...material, id: "22345678-1234-4234-8234-123456789abc", name: "Lecture 6 - Other.pdf" }]]) {
      const html = renderToStaticMarkup(createElement(StudyMarkdown, {
        text: "Sourced from: Lecture 6.pdf, pg. 6-7.", materials, onOpenMaterial: vi.fn(),
      }))
      expect(html).not.toContain("<a ")
    }
  })

  it("leaves existing HTTPS citations intact", () => {
    const html = renderToStaticMarkup(createElement(StudyMarkdown, {
      text: "Sourced from: [Lecture 6.pdf, pg. 6-7.](https://example.com/lecture.pdf#page=6)",
      materials: [material], onOpenMaterial: vi.fn(),
    }))
    expect(html).toContain('href="https://example.com/lecture.pdf#page=6"')
    expect(html).not.toContain("edu-material://")
  })

  it("hides raw section anchors while keeping their headings visible", () => {
    const html = render('<a id="foundations"></a>\n\n## 1. Foundations: alphabets, strings, and languages')
    expect(html).toContain('<h2 id="foundations">1. Foundations: alphabets, strings, and languages</h2>')
    expect(html).not.toContain("&lt;a")
    expect(html).not.toContain("&lt;/a&gt;")
  })

  it("renders evidence links to their explicit Check anchors", () => {
    const html = render('<a id="check-c1-01"></a>\n#### Check C1-01 — Explain the instruction cycle\n\nEvidence: [Attempt](#check-c1-01).')
    expect(html).toContain('id="check-c1-01"')
    expect(html).toContain('<a href="#check-c1-01">Attempt</a>')
  })

  it("preserves anchor markup when it is an intentional code example", () => {
    for (const text of ['`<a id="foundations"></a>`', '```html\n<a id="foundations"></a>\n```']) {
      const html = render(text)
      expect(html.replace(/<\/?span\b[^>]*>/g, "")).toContain('&lt;a id=&quot;foundations&quot;&gt;&lt;/a&gt;')
      expect(html).toContain("<code")
    }
  })
})
