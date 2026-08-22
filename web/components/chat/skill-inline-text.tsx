import type { ReactNode } from "react"

import {
  CHAT_SKILL_CHIP_CLASS_NAME,
  SKILL_CHIP_ICON_CLASS_NAME,
  SKILL_CHIP_ICON_SVG,
  SKILL_CHIP_LABEL_CLASS_NAME,
} from "@/components/chat/inline-chip"
import { collectSkillTokens } from "@/lib/chat/inline-tokens"
import {
  formatSkillDisplayName,
  getSkillByName,
  type ChatSkill,
} from "@/lib/chat/skills"
import { cn } from "@/lib/utils"

type SkillInlineTextProps = {
  text: string
  skills?: ReadonlyArray<ChatSkill>
  chipClassName?: string
}

export function SkillInlineText({
  text,
  skills,
  chipClassName = CHAT_SKILL_CHIP_CLASS_NAME,
}: SkillInlineTextProps) {
  const nodes: ReactNode[] = []
  let cursor = 0

  for (const match of collectSkillTokens(text)) {
    const skill = getSkillByName(match.name)
    if (!skill) {
      continue
    }
    if (skills && !skills.some((candidate) => candidate.name === match.name)) {
      continue
    }

    if (match.start > cursor) {
      nodes.push(text.slice(cursor, match.start))
    }
    nodes.push(
      <SkillChip
        key={`${match.start}:${match.name}`}
        skill={skill}
        rawText={match.rawText}
        chipClassName={chipClassName}
      />
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

function SkillChip(props: {
  skill: ChatSkill
  rawText: string
  chipClassName: string
}) {
  return (
    <span className="inline-flex align-middle leading-none" data-markdown-copy={props.rawText}>
      <span className={cn(props.chipClassName)}>
        <span
          aria-hidden="true"
          className={SKILL_CHIP_ICON_CLASS_NAME}
          dangerouslySetInnerHTML={{ __html: SKILL_CHIP_ICON_SVG }}
        />
        <span className={SKILL_CHIP_LABEL_CLASS_NAME}>
          {formatSkillDisplayName(props.skill)}
        </span>
      </span>
    </span>
  )
}
