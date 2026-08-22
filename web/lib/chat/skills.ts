export type ChatSkill = {
  name: string
  displayName: string
  description?: string
}

/** UI-only skills for inline chip rendering. */
export const MOCK_SKILLS: ChatSkill[] = [
  {
    name: "new",
    displayName: "New",
    description: "Start something new.",
  },
]

const skillByName = new Map(MOCK_SKILLS.map((skill) => [skill.name, skill]))

export function getSkillByName(name: string): ChatSkill | undefined {
  return skillByName.get(name)
}

export function formatSkillDisplayName(skill: Pick<ChatSkill, "name" | "displayName">): string {
  return skill.displayName.trim() || skill.name
}
