import { describe, expect, it } from "vitest"
import { prepareVisualizationMarkdown } from "../src/renderer/visualization/markdown"

const element = `<visualization settings='{"type":"Plotly.js","data":[{"type":"scatter","text":["/> and \\u0027"],"x":[1],"y":[2]}]}' />`

describe("visualization Markdown transport", () => {
  it("extracts multiple standalone elements without consuming surrounding text", () => {
    const result = prepareVisualizationMarkdown(`Before\n\n${element}\n\nBetween\n\n${element}\n\nAfter`)
    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0]).toMatchObject({ source: element, pending: false })
    expect(result.text).toContain("Before")
    expect(result.text).toContain("Between")
    expect(result.text).toContain("After")
    expect(result.text).not.toContain("settings=")
  })
  it.each([
    `\`${element}\``, `\`\`\`html\n${element}\n\`\`\``, `~~~~html\r\n${element}\r\n~~~~~`,
    `    ${element}`, `\`\`\`html\n${element}`, `- Example:\n\n  \`\`\`html\n  ${element}\n  \`\`\``,
    `<script>\n${element}\n</script>`, `Example ${element}`,
  ])("keeps code and non-standalone markup literal", (text) => {
    expect(prepareVisualizationMarkdown(text)).toMatchObject({ text, blocks: [] })
  })
  it.each(["<visualization", "<visualization settings=", "<visualization settings='{\n\"type\":\"Plotly.js\""])("reserves partial streams: %s", (source) => {
    const result = prepareVisualizationMarkdown(`Before\n\n${source}`)
    expect(result.blocks).toEqual([{ source, pending: true }])
    expect(result.text).not.toContain(source)
  })
  it("accepts multiline CRLF and leaves later Markdown intact", () => {
    const source = element.replace('{"type"', '{\r\n"type"')
    expect(prepareVisualizationMarkdown(`${source}\r\n\r\nAfter`).blocks).toEqual([{ source, pending: false }])
  })
  it("does not confuse original placeholder-like code with generated blocks", () => {
    const text = `\`\`\`edu-visualization-0\n0\n\`\`\`\n\n${element}`
    const result = prepareVisualizationMarkdown(text)
    expect(result.text).toContain("```edu-visualization-0\n0\n```")
    expect(result.blocks).toHaveLength(1)
  })
})
