export function normalizeMathDelimiters(text: string) {
  // Markdown consumes escaped brackets before remark-math can recognize them.
  const tokens = /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)|(`+)|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/gm
  const parts: string[] = []
  let cursor = 0
  let match = tokens.exec(text)

  while (match) {
    parts.push(text.slice(cursor, match.index))
    const [, fence, backticks, displayMath, inlineMath] = match

    if (fence) {
      const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*\\r?$`, "gm")
      closing.lastIndex = tokens.lastIndex
      const end = closing.exec(text)
      tokens.lastIndex = end ? closing.lastIndex : text.length
      parts.push(text.slice(match.index, tokens.lastIndex))
    } else if (backticks) {
      const closing = new RegExp("(?<!`)" + backticks + "(?!`)", "g")
      closing.lastIndex = tokens.lastIndex
      const end = closing.exec(text)
      if (end) tokens.lastIndex = closing.lastIndex
      parts.push(text.slice(match.index, tokens.lastIndex))
    } else if (displayMath !== undefined) {
      parts.push(`\n\n$$\n${displayMath.trim()}\n$$\n\n`)
    } else if (inlineMath !== undefined) {
      parts.push(`$${inlineMath.trim()}$`)
    }

    cursor = tokens.lastIndex
    match = tokens.exec(text)
  }

  parts.push(text.slice(cursor))
  return parts.join("")
}
