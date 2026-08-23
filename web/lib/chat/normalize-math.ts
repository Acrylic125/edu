export function normalizeAssistantMath(text: string) {
  let next = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => {
    return `$$${body}$$`
  })
  next = next.replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => {
    return `$${body}$`
  })
  next = next.replace(
    /\[\s*([^[\]]*\\[a-zA-Z]+[^[\]]*)\]/g,
    (_, body: string) => {
      return `$$${body}$$`
    }
  )
  return repairBmatrixRows(next)
}

function repairBmatrixRows(text: string) {
  return text.replace(
    /\\begin\{bmatrix\}([\s\S]*?)\\end\{bmatrix\}/g,
    (_, body: string) => {
      const rows = body.replace(/(?<!\\)\\(?![\\a-zA-Z])/g, "\\\\")
      return `\\begin{bmatrix}${rows}\\end{bmatrix}`
    }
  )
}
