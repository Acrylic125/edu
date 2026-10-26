import type { Parent, PhrasingContent, Root, RootContent } from "mdast"
import type { z } from "zod"
import type { ContentBlockSchema } from "../shared/content-document"

export type TopicTerm = Extract<z.infer<typeof ContentBlockSchema>, { type: "term" }>

export function topicTerminology({ terms }: { terms: TopicTerm[] }) {
  const definitions = new Map<string, TopicTerm>()
  for (const term of terms) {
    const key = term.term.toLowerCase()
    if (!definitions.has(key)) definitions.set(key, term)
  }
  const alternatives = [...definitions.keys()]
    .sort((left, right) => right.length - left.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  if (!alternatives.length) return
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}_])`, "giu")

  return (tree: Root) => {
    function visit(parent: Parent) {
      parent.children = parent.children.flatMap((node): RootContent[] => {
        if (node.type === "text") {
          const children: PhrasingContent[] = []
          let offset = 0
          for (const match of node.value.matchAll(pattern)) {
            const term = definitions.get(match[0].toLowerCase())
            if (!term) continue
            if (match.index > offset) children.push({ type: "text", value: node.value.slice(offset, match.index) })
            children.push({
              type: "emphasis",
              data: { hName: "mark", hProperties: { "data-term-id": term.id } },
              children: [{ type: "text", value: match[0] }],
            })
            offset = match.index + match[0].length
          }
          if (!children.length) return [node]
          if (offset < node.value.length) children.push({ type: "text", value: node.value.slice(offset) })
          return children
        }
        if (node.type === "link" || node.type === "linkReference" || node.type === "heading") return [node]
        if ("children" in node) visit(node)
        return [node]
      })
    }

    let glossaryDepth = 0
    for (const node of tree.children) {
      if (node.type === "heading") {
        if (node.depth <= glossaryDepth) glossaryDepth = 0
        const label = node.children.map((child) => "value" in child ? child.value : "").join("")
        if (label.trim().toLowerCase() === "topic terminology") glossaryDepth = node.depth
      }
      if (!glossaryDepth && node.type !== "heading" && "children" in node) visit(node)
    }
    return tree
  }
}
