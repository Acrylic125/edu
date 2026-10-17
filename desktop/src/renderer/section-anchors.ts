import type { Root } from "mdast"

export function sectionAnchors() {
  return (tree: Root) => {
    let anchor: string | undefined
    tree.children = tree.children.filter((node) => {
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
      return true
    })
  }
}
