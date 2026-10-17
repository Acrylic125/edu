import { z } from "zod"
import { TopicPartSchema } from "./topic-state"

const TopicDirectorySourceSchema = z.object({
  label: z.string().trim().min(1),
  href: z.string().trim().min(1),
})

export const TopicDirectoryEntrySchema = z.object({
  title: TopicPartSchema.shape.name,
  anchor: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  sources: z.array(TopicDirectorySourceSchema).max(1000).default([]),
  get children() {
    return z.array(TopicDirectoryEntrySchema).max(1000).default([])
  },
})

const TopicDirectorySchema = z.object({
  heading: z.string().trim().min(1).max(150),
  items: z.array(TopicDirectoryEntrySchema).min(1).max(1000),
})

// Single-quoted so the JSON's double quotes need no escaping; apostrophes must be written as \u0027.
const tagPattern = /<topic-directory\s+heading="([^"]*)"\s+items='([^']*)'\s*\/>/

export const topicDirectoryFormat = `<topic-directory heading="Topic directory" items='[{"title":"2. Arrays","anchor":"arrays","sources":[{"label":"Lecture 5A.pdf, pg. 5-6","href":"assets/Lecture 5A - Arrays.pdf#page=5"}],"children":[{"title":"2.1 Array Declaration","sources":[{"label":"Lecture 5A.pdf, pg. 7","href":"assets/Lecture 5A - Arrays.pdf#page=7"}]}]}]' />`

export function parseTopicDirectory(notes: string) {
  const match = tagPattern.exec(notes)
  if (!match)
    return {
      before: notes,
      after: "",
      error: `Topic notes need one topic directory element, written as: ${topicDirectoryFormat}`,
    }
  const before = notes.slice(0, match.index)
  const after = notes.slice(match.index + match[0].length)
  let items
  try {
    items = JSON.parse(match[2])
  } catch {
    return {
      before,
      after,
      error:
        "The topic directory items attribute must be valid JSON inside single quotes. Write apostrophes inside it as \\u0027.",
    }
  }
  const directory = TopicDirectorySchema.safeParse({ heading: match[1], items })
  if (!directory.success)
    return {
      before,
      after,
      error: `Invalid topic directory: ${z.prettifyError(directory.error)}`,
    }
  return { before, after, directory: directory.data }
}

export function topicDirectoryMarkdown(notes: string) {
  const parsed = parseTopicDirectory(notes)
  if (!parsed.directory) return notes
  const lines = (
    entries: z.infer<typeof TopicDirectoryEntrySchema>[],
    depth: number,
  ): string[] =>
    entries.flatMap((entry) => {
      let title = entry.title
      if (entry.anchor) title = `[${entry.title}](#${entry.anchor})`
      const sources = entry.sources
        .map((source) => `[${source.label}](<${source.href}>)`)
        .join(", ")
      return [
        `${"  ".repeat(depth)}- ${[title, sources].filter(Boolean).join(" ")}`,
        ...lines(entry.children, depth + 1),
      ]
    })
  return `${parsed.before}## ${parsed.directory.heading}\n\n${lines(parsed.directory.items, 0).join("\n")}${parsed.after}`
}

export function topicOutline(notes: string) {
  const titles = (entries: z.infer<typeof TopicDirectoryEntrySchema>[]): string[] =>
    entries.flatMap((entry) => [entry.title, ...titles(entry.children)])
  return titles(parseTopicDirectory(notes).directory?.items ?? []).slice(0, 100)
}

export function validateTopicDirectory(notes: string) {
  if (/^#{1,6}\s+Topic directory\b/im.test(notes))
    throw new Error(
      'Replace the markdown "Topic directory" section with one <topic-directory /> element.',
    )
  const parsed = parseTopicDirectory(notes)
  if (parsed.error) throw new Error(parsed.error)
  if (tagPattern.test(parsed.after))
    throw new Error("Topic notes can contain only one <topic-directory /> element.")
}
