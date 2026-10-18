import { unified } from "unified"
import remarkParse from "remark-parse"
import type { Root, RootContent } from "mdast"

const parser = unified().use(remarkParse)

export function prepareVisualizationMarkdown(text: string) {
  const protectedRanges: { start: number; end: number }[] = []
  const protectCode = (node: Root | RootContent) => {
    if (node.type === "code" || node.type === "inlineCode" || (node.type === "html" && !/^<visualization(?:\s|\/?>|$)/.test(node.value))) {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) protectedRanges.push({ start, end })
      return
    }
    if ("children" in node) for (const child of node.children) protectCode(child)
  }
  protectCode(parser.parse(text))
  let namespace = "edu-visualization-0"
  while (text.includes(namespace)) namespace += "x"
  const blocks: { source: string; pending: boolean }[] = []
  const parts: string[] = []
  const starts = /^ {0,3}<visualization(?=\s|\/?>|$)/gm
  let cursor = 0
  let match = starts.exec(text)
  while (match) {
    const start = match.index + match[0].indexOf("<")
    if (protectedRanges.some((range) => start >= range.start && start < range.end)) {
      match = starts.exec(text)
      continue
    }
    let quoted = false
    let end = text.length
    let pending = true
    for (let index = start + "<visualization".length; index < text.length; index++) {
      if (text[index] === "'") quoted = !quoted
      if (!quoted && text.startsWith("/>", index)) {
        end = index + 2
        pending = false
        break
      }
    }
    if (!pending && !/^[ \t]*(?:\r?\n|$)/.test(text.slice(end))) {
      match = starts.exec(text)
      continue
    }
    parts.push(text.slice(cursor, match.index), `\n\n\`\`\`${namespace}\n${blocks.length}\n\`\`\`\n\n`)
    blocks.push({ source: text.slice(start, end), pending })
    cursor = end
    starts.lastIndex = end
    match = starts.exec(text)
  }
  parts.push(text.slice(cursor))
  return { text: parts.join(""), blocks, namespace }
}

export function visualizationMarkdown(prepared: ReturnType<typeof prepareVisualizationMarkdown>) {
  return () => (tree: Root) => {
    const transform = (node: Root | RootContent) => {
      if (node.type === "code" && node.lang === prepared.namespace && /^\d+$/.test(node.value)) {
        const index = Number(node.value)
        if (prepared.blocks[index]) {
          Object.assign(node, { type: "paragraph", children: [], data: { hName: "div", hProperties: { "data-visualization-index": index } } })
        }
      }
      if ("children" in node) for (const child of node.children) transform(child)
    }
    transform(tree)
  }
}
