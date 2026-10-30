import assert from "node:assert/strict"
import { test } from "node:test"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { ContentBlockSchema } from "./content-document"
import { renderContentBlock } from "./scratchpad-markdown"

test("escaped Mermaid line breaks in a saved lesson produce diagrams rather than inline code", () => {
  const block = ContentBlockSchema.parse({ type: "markdown", id: "ranges-meta-chunking", sectionId: "tp-section-1", content: [
    "### Bound processing and locate the exact passage",
    "A bounded job processes the relevant appendix.",
    "```mermaid\\nflowchart LR\\n  R[1,200-page report] -->|bounded job| A[Pages 80–95: relevant appendix]\\n  R -->|separate bounded job| B[Another page range]\\n  A -. independent work may overlap .-> B\\n```",
    "Keep the document and page locators with the passage.",
    "```mermaid\\nflowchart LR\\n  Doc[Report title and URI] --> P[Page 88]\\n  P --> C1[Chunk ID: c-17]\\n  P --> C2[Chunk ID: c-18]\\n  C2 --> Claim[Exact passage supporting a claim]\\n```",
    "The chunk ID identifies the exact passage.",
  ] })
  const rendered = renderContentBlock(block, [])
  const nodes = unified().use(remarkParse).parse(rendered).children
  const diagrams = nodes.filter((node) => node.type === "code" && node.lang === "mermaid")
  assert.equal(diagrams.length, 2)
  assert.equal(diagrams[0].type, "code")
  if (diagrams[0].type === "code") assert.match(diagrams[0].value, /^flowchart LR\n/)
  assert.ok(rendered.includes("Keep the document and page locators with the passage."))
  assert.ok(rendered.includes("The chunk ID identifies the exact passage."))
})

test("repairing diagram markup preserves ordinary code, properly fenced diagrams and literal escape examples", () => {
  const content = [
    "```ts",
    'const separator = "\\n"',
    "```",
    "```mermaid",
    'flowchart LR\n  A["Literal \\n in a label"] --> B[Output]',
    "```",
    "````text",
    "```mermaid\\nflowchart LR\\n  A --> B\\n```",
    "````",
  ]
  const block = ContentBlockSchema.parse({ type: "markdown", id: "literal-escapes", content })
  assert.equal(renderContentBlock(block, []), content.join("\n"))
})
