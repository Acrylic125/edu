import { CHAT_COMMANDS } from "@/lib/chat/skills"

export type SkillTokenMatch = {
  name: string
  rawText: string
  start: number
  end: number
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildSkillTokenRegex(): RegExp {
  const names = CHAT_COMMANDS.map((skill) => escapeRegExp(skill.name)).join("|")
  return new RegExp(`(^|\\s)\\/(${names})(?=\\s|$)`, "g")
}

const SKILL_TOKEN_REGEX = buildSkillTokenRegex()

export function collectSkillTokens(text: string): SkillTokenMatch[] {
  const matches: SkillTokenMatch[] = []

  for (const match of text.matchAll(SKILL_TOKEN_REGEX)) {
    const prefix = match[1] ?? ""
    const name = match[2] ?? ""
    if (!name) {
      continue
    }
    const start = (match.index ?? 0) + prefix.length
    const rawText = `/${name}`
    matches.push({
      name,
      rawText,
      start,
      end: start + rawText.length,
    })
  }

  return matches
}
