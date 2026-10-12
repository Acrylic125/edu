import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { StudyMarkdown } from "../src/renderer/markdown"

vi.mock("../src/renderer/mermaid-diagram", () => ({
  MermaidDiagram: ({ definition }: { definition: string }) =>
    createElement("div", { "data-diagram": definition }),
}))

function render(text: string) {
  return renderToStaticMarkup(createElement(StudyMarkdown, { text }))
}

describe("study Markdown", () => {
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
    expect(render("```ts\nconst x = 1\n```")).toContain('<pre><code class="language-ts">')
  })

  it("keeps Markdown lists, tables, and links working", () => {
    const html = render("- First\n- Second\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n[Docs](https://example.com)")
    expect(html).toContain("<ul>")
    expect(html).toContain("<table>")
    expect(html).toContain('href="https://example.com"')
  })
})
