import type { Nodes, Root, RootContent } from "mdast"
import type { Snapshot } from "../shared/contracts"
import { materialDisplayName, resolveMaterialLink } from "../shared/material-links"

export function sourcePreviews({ enabled, materials }: {
  enabled: boolean
  materials: Snapshot["topics"][number]["materials"]
}) {
  return (tree: Root) => {
    if (!enabled) return
    const displayed = new Set<string>()
    const cited = new Map<string, ReturnType<typeof resolveMaterialLink>>()
    function visit(node: Nodes) {
      if (node.type === "image") displayed.add(node.url)
      if (node.type === "link") {
        const source = resolveMaterialLink(node.url, materials)
        if (source) cited.set(`prune-source://${source.id}/${source.page}`, source)
      }
      if ("children" in node) node.children.forEach(visit)
    }
    visit(tree)
    tree.children = tree.children.flatMap((node) => {
      cited.clear()
      if (node.data?.hProperties?.["data-understanding-check"]) return [node]
      visit(node)
      const previews: RootContent[] = []
      for (const [url, source] of cited) {
        if (!source || displayed.has(url)) continue
        const material = materials.find((material) => material.id === source.id)
        if (!material || material.kind === "text") continue
        const label = `${materialDisplayName(material, materials)}, page ${source.page}`
        displayed.add(url)
        previews.push({ type: "paragraph", children: [{ type: "image", url, alt: label }] })
        previews.push({
          type: "paragraph",
          children: [{ type: "link", url: `edu-material://${source.id}/${source.page}`, children: [{ type: "text", value: label }] }],
        })
      }
      return [node, ...previews]
    })
  }
}
