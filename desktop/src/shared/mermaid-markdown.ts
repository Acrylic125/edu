export function normalizeMermaidMarkdown(markdown: string) {
  const lines = []
  let openFence: string | undefined
  for (const line of markdown.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (openFence) {
      if (marker && marker[1][0] === openFence[0] && marker[1].length >= openFence.length && !marker[2].trim())
        openFence = undefined
      lines.push(line)
      continue
    }
    if (marker) {
      const escaped = /^mermaid((?:\\+r)?\\+n.*)$/i.exec(marker[2])
      // Decode only a complete escaped diagram, preserving escape examples inside ordinary code fences.
      if (escaped && escaped[1].trimEnd().endsWith(marker[1])) {
        lines.push(line.replace(/\\+r\\+n|\\+n/g, "\n"))
        continue
      }
      openFence = marker[1]
    }
    lines.push(line)
  }
  return lines.join("\n")
}
