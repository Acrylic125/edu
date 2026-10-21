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
  it("shows cited source pages only when chat previews are enabled and avoids duplicate images", () => {
    const text = `The source shows a fixed-width instruction. [Source](edu-material://${material.id}/2) and [same page](<assets/${material.name}#page=2>)\n\n> [!CHECK]\n> Why use a fixed width?`
    const props = { text, materials: [material] }
    const scratchpad = renderToStaticMarkup(createElement(StudyMarkdown, props))
    expect(scratchpad).not.toContain("<img")
    const chat = renderToStaticMarkup(createElement(StudyMarkdown, { ...props, showSourcePreviews: true }))
    expect(chat.match(/<img /g)).toHaveLength(1)
    expect(chat.indexOf("<img ")).toBeLessThan(chat.indexOf('aria-label="Check your understanding"'))
    expect(chat).toContain(`src="prune-source://${material.id}/2"`)
    const embedded = renderToStaticMarkup(createElement(StudyMarkdown, {
      ...props, showSourcePreviews: true,
      text: `${text}\n\n![Existing source](prune-source://${material.id}/2)`,
    }))
    expect(embedded.match(/<img /g)).toHaveLength(1)
  })

  it("does not turn unknown sources or text assets into broken source images", () => {
    const html = renderToStaticMarkup(createElement(StudyMarkdown, {
      text: `[Text](edu-material://${material.id}/1) [Missing](edu-material://00000000-0000-4000-8000-000000000000/1)`,
      materials: [{ ...material, kind: "text" }], showSourcePreviews: true,
    }))
    expect(html).not.toContain("<img")
  })

  it("preserves MIPS registers as literal text in checks and scratchpad prose", () => {
    const text = "Given $9 = 7 and $10 = 5, what result should `add $8, $9, $10` produce in $8? Register $t0 stores the sum of $t1 and $t2."
    const html = render(`> [!CHECK]\n> ${text}`)
    expect(html).not.toContain('class="katex"')
    expect(html).toContain("Given $9 = 7 and $10 = 5")
    expect(html).toContain("produce in $8?")
    expect(html).toContain("Register $t0 stores the sum of $t1 and $t2.")
    expect(html).toContain("<code>add $8, $9, $10</code>")
  })

  it("keeps genuine math alongside registers without changing escaped dollars", () => {
    const html = render(String.raw`Register $9 holds 7. There are $2^5 = 32$ patterns; $7 + 5 = 12$. With \(x = 2\), $10 holds 5. The price is \$8.`)
    expect(html.match(/class="katex"/g)).toHaveLength(3)
    expect(html).toContain("Register $9 holds 7.")
    expect(html).toContain("$10 holds 5. The price is $8.")
    expect(html).not.toContain("katex-error")
  })

  it.each(["$2 +\n3$", "$2^n$bits", "$2 = xy$", "$2 + xy$"])("preserves supported inline math boundaries: %s", (text) => {
    const html = render(text)
    expect(html).toContain('class="katex"')
    expect(html).not.toContain("katex-error")
  })

  it.each([
    ["Register $9 holds 7; compute ", "$x + 1$"],
    ["Register $t0 is the input. Evaluate ", "$x^2$"],
  ])("keeps register prose separate from following variable math", (prose, math) => {
    const html = render(prose + math)
    expect(html).toContain(`<p>${prose}<span class="katex">`)
    expect(html.match(/class="katex"/g)).toHaveLength(1)
    expect(html).not.toContain("katex-error")
  })

  it("renders understanding checks as labelled cards with rich question content", () => {
    const html = render("An explanation.\n\n> [!CHECK]\n> Why does **five bits** cover $2^5$ values?\n>\n> - Explain the range.\n> - Use `0–31`.\n\nNext section.")
    expect(html).toContain('aria-label="Check your understanding"')
    expect(html).toContain('class="understanding-check')
    expect(html).toContain('<strong>five bits</strong>')
    expect(html).toContain('class="katex"')
    expect(html).toContain('<li>Use <code>0–31</code>.</li>')
    expect(html).not.toContain('[!CHECK]')
    expect(html).toMatch(/<\/section>\s*<p>Next section\.<\/p>/)
  })

  it("renders existing Check paragraphs as cards while preserving ordinary quotes and examples", () => {
    const html = render("**Check:** Why binary?\n\n> A source quotation.\n\n```markdown\n> [!CHECK]\n> Example only.\n```\n\n**Note:** Keep this as prose.")
    expect(html.match(/aria-label="Check your understanding"/g)).toHaveLength(1)
    expect(html).toContain('<p>Why binary?</p>')
    expect(html).toContain('<blockquote>\n<p>A source quotation.</p>\n</blockquote>')
    expect(html).toContain('[!CHECK]')
    expect(html).toContain('<strong>Note:</strong> Keep this as prose.')
  })

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
    expect(html).toContain(`<a href="edu-material://${material.id}/1" title="${name}">Lecture 4A - Pointers and Funct….${extension}</a>`)
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

it("shortens opaque source names while preserving page ranges and link targets", () => {
  const name = "c3e312d6-5a40-42a6-893a-559bfa0fd7d9-b29c1ab5-88d4-4a6a-988a-1ee55fafeb31-pdf.pdf"
  const source = { ...material, name }
  const html = renderToStaticMarkup(createElement(StudyMarkdown, {
    text: `Sourced from: ${name}, pg. 7-8.`,
    materials: [source],
    onOpenMaterial: vi.fn(),
  }))
  expect(html).toContain('>Document.pdf, pg. 7-8</a>')
  expect(html).toContain(`<a href="edu-material://${material.id}/7"`)
  expect(html).toContain(`title="${name}"`)
})


it("repairs spaced asset destinations with parentheses while preserving code samples", () => {
  const link = `[Lecture PDF](assets/${material.name}#page=6)`
  const html = renderToStaticMarkup(createElement(StudyMarkdown, {
    text: `${link}\n\n\`${link}\`\n\n\`\`\`markdown\n${link}\n\`\`\``, materials: [material], onOpenMaterial: vi.fn(),
  }))
  expect(html.match(/<a /g)).toHaveLength(1)
  expect(html).toContain(`href="edu-material://${material.id}/6"`)
  expect(html).toContain(`<code>${link}</code>`)
})
