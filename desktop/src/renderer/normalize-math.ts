export function normalizeMathDelimiters(text: string) {
  const literalRegisters = (prose: string) => prose.replace(
    /(?<![\\\w$])\$(?:3[01]|[12]\d|\d|zero|at|v[01]|a[0-3]|t\d|s[0-8]|k[01]|gp|sp|fp|ra)\b(?!\$)/g,
    (register) => `\\${register}`,
  )
  // Markdown consumes escaped brackets before remark-math can recognize them.
  const tokens = /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)|(`+)|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|(\$\$[\s\S]*?\$\$)|(?<![\\$])\$(?!\$)((?:\\.|[^$\\\r\n]|\r?\n(?![ \t]*\r?\n))+)\$(?!\$|(?:3[01]|[12]\d|\d|zero|at|v[01]|a[0-3]|t\d|s[0-8]|k[01]|gp|sp|fp|ra)\b)/gm
  const parts: string[] = []
  let cursor = 0
  let match = tokens.exec(text)

  while (match) {
    parts.push(literalRegisters(text.slice(cursor, match.index)))
    const [, fence, backticks, displayMath, inlineMath, dollarDisplay, dollarInline] = match

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
    } else if (dollarInline !== undefined &&
      literalRegisters(`$${dollarInline}`) !== `$${dollarInline}` &&
      !dollarInline.includes("\\") && /\b(?:and|or|holds|contains|is|are|the|registers?|input|output|compute|evaluate|given|with)\b/i.test(dollarInline)) {
      // A register in prose must not consume the opening dollar of the following formula.
      parts.push("\\$")
      tokens.lastIndex = match.index + 1
    } else if (dollarDisplay !== undefined || dollarInline !== undefined) {
      parts.push(match[0])
    }

    cursor = tokens.lastIndex
    match = tokens.exec(text)
  }

  parts.push(literalRegisters(text.slice(cursor)))
  return parts.join("")
}
