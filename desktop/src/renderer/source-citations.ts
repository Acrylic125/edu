import type { Snapshot } from "../shared/contracts"
import { materialCitationNames, resolveMaterialLink } from "../shared/material-links"

export function linkSourceCitations(text: string, materials: Snapshot["topics"][number]["materials"]) {
  const unique = materials.filter((material, index) =>
    materials.findIndex((item) => item.id === material.id) === index,
  )
  const aliases = unique.flatMap((material) => materialCitationNames(material.name).map((label) => ({ id: material.id, label })))
  const names = aliases.filter((material) =>
    aliases.filter((item) => item.label === material.label).length === 1,
  ).sort((a, b) => b.label.length - a.label.length)
  if (!names.length) return text
  const filenames = names.map((material) => material.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
  const references = new RegExp(`\\x60+[^\\x60]*\\x60+|\\[[^\\]\\n]*\\]\\([^\\n]*?\\)|(${filenames})(,\\s*pg\\.\\s*(\\d+)(?:\\s*[-–]\\s*\\d+)?)?`, "g")
  const assetLinks = new RegExp(`\\]\\((assets\\/(?:${filenames})(?:#page=\\d+)?)\\)`, "g")
  const codeAndCitations = /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)|(`+)|(^ {4,}[^\r\n]*(?:\r?\n|$))|Sourced from:[^\r\n]*/
  const tokens = new RegExp(`${codeAndCitations.source}|${assetLinks.source}`, "gm")
  const parts: string[] = []
  let cursor = 0
  let match = tokens.exec(text)
  while (match) {
    parts.push(text.slice(cursor, match.index))
    const [, fence, backticks, indentedCode] = match
    if (indentedCode) {
      parts.push(match[0])
    } else if (fence || backticks) {
      let closing: RegExp
      if (fence) closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*\\r?$`, "gm")
      else closing = new RegExp("(?<!`)" + backticks + "(?!`)", "g")
      closing.lastIndex = tokens.lastIndex
      const end = closing.exec(text)
      if (end) tokens.lastIndex = closing.lastIndex
      else if (fence) tokens.lastIndex = text.length
      parts.push(text.slice(match.index, tokens.lastIndex))
    } else {
      const linked = match[0].replace(assetLinks, (original, href: string) => {
        if (!resolveMaterialLink(href, unique)) return original
        return `](<${href}>)`
      })
      if (match[4]) {
        parts.push(linked)
        cursor = tokens.lastIndex
        match = tokens.exec(text)
        continue
      }
      parts.push(linked.replace(references, (label: string, name: string | undefined, pages: string | undefined, page: string | undefined) => {
        if (!name) return label
        const material = names.find((item) => item.label === name)
        if (!material) return label
        const escaped = `${name}${pages ?? ""}`.replace(/[\\[\]]/g, "\\$&")
        return `[${escaped}](edu-material://${material.id}/${page ?? 1})`
      }))
    }
    cursor = tokens.lastIndex
    match = tokens.exec(text)
  }
  parts.push(text.slice(cursor))
  return parts.join("")
}
