import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"

export const teachingSkills = ["skills/FEEDBACK_AND_DELIBERATE.md", "skills/WHAT_IS_UNDERSTANDING.md", "skills/WRITING_STYLE.md", "skills/UNSLOP.md"] as const
export const skillFiles = [
  "skills/MANAGE_TOPIC.md", "skills/MANAGE_TEST.md", "skills/MANAGE_GENERIC.md",
  ...teachingSkills,
  ...(["topic", "test", "generic"] as const).flatMap((role) => [
    `scratchpad_templates/${role}/schema.md`, `scratchpad_templates/${role}/tools.md`, `scratchpad_templates/${role}/scratchpad_${role}.md`,
  ]),
] as const

const SkillHeaderSchema = z.object({ name: z.string().min(1), description: z.string().min(1).max(2000) })

export async function readSkillCatalog(directory: string, paths: readonly string[]) {
  return Promise.all(paths.filter((path) => path.startsWith("skills/")).map(async (path) => {
    const text = await readFile(join(directory, path), "utf8")
    const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1]
    if (!header) throw new Error(`Bundled skill is missing its header: ${path}`)
    const fields = Object.fromEntries(header.split(/\r?\n/).flatMap((line) => {
      const field = /^(name|description):\s*(.+)$/.exec(line)
      if (!field) return []
      return [[field[1], field[2].trim().replace(/^(["'])(.*)\1$/, "$2")]]
    }))
    return { path, ...SkillHeaderSchema.parse(fields) }
  }))
}
