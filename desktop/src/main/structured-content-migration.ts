import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import type { RootContent, PhrasingContent } from "mdast"
import { z } from "zod"
import { ContentDocumentSchema } from "../shared/content-document"
import { ScratchpadStateSchema, testScratchpadMarkdown } from "../shared/scratchpad-state"
import { parseTopicDirectory } from "../shared/topic-directory"

const parser = unified().use(remarkParse).use(remarkGfm)
function nodeText(node: RootContent | PhrasingContent): string {
  if ("value" in node) return node.value
  if ("children" in node) return node.children.map(nodeText).join("")
  return ""
}

export function importStructuredContent(state: z.infer<typeof ScratchpadStateSchema>, notes: string) {
  if (state.type === "generic" || state.document) return state
  const document = ContentDocumentSchema.parse({ version: 1, blocks: [] })
  if (state.type === "test" && notes.trim() === testScratchpadMarkdown(state).trim()) return { ...state, document }
  const directory = parseTopicDirectory(notes)
  const entries = [...directory.directory?.items ?? []]
  for (const entry of entries) entries.push(...entry.children)
  let body = notes
  if (directory.directory) body = `${directory.before}${directory.after}`
  const nodes = parser.parse(body).children
  let sectionId: string | undefined
  let terminology = false
  for (const [index, node] of nodes.entries()) {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) continue
    const raw = body.slice(start, end)
    if (index === 0 && node.type === "heading" && node.depth === 1) continue
    if (node.type === "html" || node.type === "paragraph") {
      // Legacy markup is interpreted once during import, never as a condition for later writes.
      const anchor = /^<a\s+id=["']([^"']+)["']\s*>\s*<\/a>$/.exec(raw.trim())?.[1]
      const entry = entries.find((entry) => entry.anchor === anchor)
      const part = state.content.find((part) => part.id === anchor || (entry && part.name === entry.title))
      if (anchor && part) { sectionId = part.id; continue }
    }
    if (node.type === "heading" && node.depth === 2) {
      terminology = nodeText(node) === "Topic terminology"
      if (terminology) { sectionId = undefined; continue }
      const part = state.content.find((part) => part.name === nodeText(node))
      if (part) { sectionId = part.id; continue }
    }
    if (terminology && node.type === "table" && node.children[0]?.children.length === 2) {
      for (const row of node.children.slice(1)) {
        const [term, meaning] = row.children.map(nodeText)
        if (term?.trim() && meaning?.trim()) document.blocks.push({ type: "term", id: `legacy-term-${index}-${document.blocks.length}`, term, meaning })
      }
      continue
    }
    document.blocks.push({ type: "markdown", id: `legacy-${index}`, ...(sectionId && { sectionId }), content: raw.split("\n") })
  }
  return { ...state, document: ContentDocumentSchema.parse(document) }
}
