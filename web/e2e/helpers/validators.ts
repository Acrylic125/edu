import katex from "katex"
import mermaid from "mermaid"
import type { MessagePart } from "@edu/chat-contract"

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\b(?:sk|rk)-[A-Za-z0-9_-]{20,}\b/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/i,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
]

function withoutCodeFences(text: string) {
  return text.replace(/```[\s\S]*?```/g, "")
}

export function validateSafety(text: string, secrets: readonly string[] = []) {
  for (const secret of secrets) {
    if (secret.length >= 8 && text.includes(secret)) {
      throw new Error("Assistant response contains a configured secret")
    }
  }

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`Assistant response matches a secret pattern: ${pattern}`)
    }
  }
}

function extractDelimitedMath(text: string) {
  const expressions: string[] = []
  const delimiters = [
    { open: "$$", close: "$$" },
    { open: "\\[", close: "\\]" },
    { open: "\\(", close: "\\)" },
  ]
  for (const delimiter of delimiters) {
    let cursor = 0
    while (cursor < text.length) {
      const start = text.indexOf(delimiter.open, cursor)
      if (start < 0) break
      const end = text.indexOf(delimiter.close, start + delimiter.open.length)
      if (end < 0) {
        throw new Error(`Unclosed LaTeX delimiter ${delimiter.open}`)
      }
      expressions.push(text.slice(start + delimiter.open.length, end))
      cursor = end + delimiter.close.length
    }
  }
  return expressions
}

export function validateLaTeX(text: string) {
  const candidate = withoutCodeFences(text)
  const expressions = extractDelimitedMath(candidate)
  for (const expression of expressions) {
    katex.renderToString(expression, { throwOnError: true, strict: "error" })
  }
}

function mermaidBlocks(text: string) {
  const blocks: string[] = []
  const pattern = /```mermaid(?:\s|\r?\n)([\s\S]*?)```/gi
  const openings = text.match(/```mermaid(?:\s|\r?\n)/gi)?.length ?? 0
  let match = pattern.exec(text)
  while (match) {
    blocks.push(match[1] ?? "")
    match = pattern.exec(text)
  }
  if (blocks.length !== openings) {
    throw new Error("Unclosed Mermaid code fence")
  }
  return blocks
}

let mermaidInitialized = false

export async function validateMermaid(text: string) {
  const blocks = mermaidBlocks(text)
  if (blocks.length === 0) return
  if (!mermaidInitialized) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" })
    mermaidInitialized = true
  }
  for (const block of blocks) {
    await mermaid.parse(block)
  }
}

export async function validateAssistantText(text: string, secrets: readonly string[] = []) {
  validateSafety(text, secrets)
  validateLaTeX(text)
  await validateMermaid(text)
}

export async function validateMessageParts(parts: MessagePart[], secrets: readonly string[] = []) {
  const content: string[] = []
  for (const part of parts) {
    if (part.type === "text") content.push(part.content)
    if (part.type === "attachment") content.push(part.ref)
    if (part.type === "options") content.push(...part.options.map((option) => option.label))
    if (part.type === "plan") content.push(...part.steps.flatMap((step) => [step.label, step.summary]))
    if (part.type === "proposal") content.push(part.prompt)
  }
  await validateAssistantText(content.join("\n"), secrets)
}
