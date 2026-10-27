import { unified } from "unified"
import remarkParse from "remark-parse"
import type { Snapshot } from "../shared/contracts"

const parser = unified().use(remarkParse)

function normalizePrompt(text: string) {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
}

export function replyContainsResponseQuestion(content: string, question: NonNullable<Snapshot["chats"][number]["messages"][number]["responseQuestion"]>) {
  const prompt = normalizePrompt(question.prompt)
  const options = question.options.map(normalizePrompt)
  for (const node of parser.parse(content).children) {
    if (node.type !== "paragraph") continue
    const text = normalizePrompt(content.slice(node.position?.start.offset, node.position?.end.offset))
    if (text.includes(prompt)) return true
    // Topic names can be abbreviated in prose; the question and option labels identify the same choice.
    if (text.split(/(?<=[.!?])\s+/).some((sentence) => sentence.endsWith("?") && options.every((option) => sentence.includes(option)))) return true
  }
  return false
}
