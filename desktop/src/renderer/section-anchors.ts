import type { Heading, Parent, Root, RootContent } from "mdast"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { normalizeMathDelimiters } from "./normalize-math"
import { prepareVisualizationMarkdown } from "./visualization/markdown"

function headingText(node: RootContent): string {
  if ("children" in node) return node.children.map(headingText).join("")
  if ("value" in node && node.type !== "html") return node.value
  if (node.type === "image") return node.alt ?? ""
  return ""
}

function headingsIn(tree: Root) {
  const headings: Heading[] = []
  function visit(node: Root | RootContent) {
    if (node.type === "heading") headings.push(node)
    if ("children" in node) node.children.forEach(visit)
  }
  visit(tree)
  return headings
}

export function sectionAnchors() {
  return (tree: Root) => {
    function visit(parent: Parent) {
      let anchor: string | undefined
      parent.children = parent.children.filter((node) => {
        let markup = ""
        if (node.type === "html") markup = node.value
        else if (node.type === "paragraph" && node.children.every((child) => child.type === "html" || (child.type === "text" && !child.value.trim()))) {
          markup = node.children.map((child) => "value" in child ? child.value : "").join("")
        }
        const match = /^<a\s+id="([a-z0-9][a-z0-9-]*)"><\/a>\s*$/i.exec(markup)
        if (match) {
          anchor = match[1]
          return false
        }
        if (node.type === "heading" && anchor) {
          node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: anchor } }
        }
        anchor = undefined
        if ("children" in node) visit(node)
        return true
      })
    }
    visit(tree)
    const headings = headingsIn(tree)
    // Reserve explicit ids before generating slugs so later anchors keep their existing targets.
    const used = new Set(headings.map((heading) => heading.data?.hProperties?.id).filter((id) => typeof id === "string"))
    for (const heading of headings) {
      if (heading.data?.hProperties?.id) continue
      const slug = headingText(heading).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section"
      let id = slug
      let suffix = 2
      while (used.has(id)) id = `${slug}-${suffix++}`
      used.add(id)
      heading.data = { ...heading.data, hProperties: { ...heading.data?.hProperties, id } }
    }
    return tree
  }
}

const headingParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(sectionAnchors)

export function markdownHeadings(markdown: string[]) {
  return markdown.flatMap((text) => {
    const prepared = prepareVisualizationMarkdown(text)
    const tree = headingParser.runSync(headingParser.parse(normalizeMathDelimiters(prepared.text)))
    return headingsIn(tree).map((heading) => ({ title: headingText(heading), id: heading.data?.hProperties?.id }))
  })
}
