const LEAD_IN =
  /^(begin with|start with|start by|focus on|study|explore|develop|next,?\s+|finally,?\s+|then\s+)/i

const STOP = new Set(["and", "then", "as", "or", "with", "for"])

const OPTION_PREFIXES = [
  "Explain ",
  "What's ",
  "Test me on ",
  "Proceed with ",
  "Try another question on ",
]

export function shortFocus(text: string) {
  const trimmed = text.trim().replace(/^\d+(?:\.\d+)*\s+/, "")
  if (trimmed.length === 0) {
    return "this topic"
  }
  if (trimmed.length <= 32 && !/[.!?,]/.test(trimmed)) {
    return trimmed
  }

  let rest = trimmed
  while (true) {
    const next = rest.replace(LEAD_IN, "").trim()
    if (next === rest) {
      break
    }
    rest = next
  }

  const clause = rest.split(/[.,;:]/)[0] ?? rest
  const words = clause.trim().split(/\s+/)
  const keep: string[] = []
  for (const word of words) {
    if (STOP.has(word.toLowerCase()) && keep.length > 0) {
      break
    }
    keep.push(word)
    if (keep.length >= 3) {
      break
    }
  }
  if (keep.length === 0) {
    return "this topic"
  }
  const label = keep.join(" ")
  const first = label[0]
  if (!first) {
    return "this topic"
  }
  return first.toUpperCase() + label.slice(1)
}

export function shortOptionLabel(label: string) {
  for (const prefix of OPTION_PREFIXES) {
    if (!label.startsWith(prefix)) {
      continue
    }
    const focus = shortFocus(label.slice(prefix.length).replace(/\?$/, ""))
    if (prefix === "What's ") {
      return `${prefix}${focus}?`
    }
    return `${prefix}${focus}`
  }
  if (label.length > 40) {
    return shortFocus(label)
  }
  return label
}
