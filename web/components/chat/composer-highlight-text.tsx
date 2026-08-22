import type { ReactNode } from "react"

import { collectSkillTokens } from "@/lib/chat/inline-tokens"
import { getSkillByName } from "@/lib/chat/skills"
import { cn } from "@/lib/utils"

const SKILL_HIGHLIGHT_CLASS = cn(
  "rounded-[0.2em] bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300"
)

/**
 * Same-length highlighting for the composer mirror layer. Tokens keep their
 * exact character count so the caret stays aligned with the textarea.
 */
export function ComposerHighlightText({ text }: { text: string }) {
  const nodes: ReactNode[] = []
  let cursor = 0

  for (const match of collectSkillTokens(text)) {
    if (!getSkillByName(match.name)) {
      continue
    }
    if (match.start > cursor) {
      nodes.push(text.slice(cursor, match.start))
    }
    nodes.push(
      <span key={`${match.start}:${match.name}`} className={SKILL_HIGHLIGHT_CLASS}>
        {match.rawText}
      </span>
    )
    cursor = match.end
  }

  if (cursor === 0) {
    return <>{text}</>
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }
  return <>{nodes}</>
}
