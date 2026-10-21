import type { Root } from "mdast"

export function understandingChecks() {
  return (tree: Root) => {
    tree.children = tree.children.map((node) => {
      if (node.type === "paragraph") {
        const label = node.children[0]
        if (label?.type !== "strong" || label.children.length !== 1 || label.children[0]?.type !== "text" || !/^Check:$/i.test(label.children[0].value)) return node
        const children = node.children.slice(1)
        if (children[0]?.type === "text") children[0] = { ...children[0], value: children[0].value.trimStart() }
        return {
          type: "blockquote",
          data: { hName: "div", hProperties: { "data-understanding-check": true } },
          children: [{ ...node, children }],
        }
      }
      if (node.type !== "blockquote") return node
      const paragraph = node.children[0]
      if (paragraph?.type !== "paragraph") return node
      const marker = paragraph.children[0]
      if (marker?.type !== "text" || !/^\[!CHECK\](?:\n|$)/.test(marker.value)) return node
      const children = paragraph.children.slice()
      children[0] = { ...marker, value: marker.value.replace(/^\[!CHECK\]\n?/, "") }
      node.children = [{ ...paragraph, children }, ...node.children.slice(1)]
      node.data = { ...node.data, hName: "div", hProperties: { ...node.data?.hProperties, "data-understanding-check": true } }
      return node
    })
  }
}
