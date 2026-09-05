export type ChatSkill = {
  name: string
  displayName: string
  description?: string
}

import { CHAT_COMMANDS } from "@edu/chat-contract"
export { CHAT_COMMANDS }

export function getSkillByName(name: string): ChatSkill | undefined {
  return CHAT_COMMANDS.find((command) => command.name === name)
}

export function formatSkillDisplayName(
  skill: Pick<ChatSkill, "name" | "displayName">,
): string {
  return skill.displayName.trim() || skill.name
}
