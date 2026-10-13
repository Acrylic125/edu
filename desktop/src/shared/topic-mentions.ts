import { IdSchema } from "./contracts"

const mentionPattern = /\[@([^\]\r\n]+)\]\(edu-topic:\/\/([^)\s]+)\)/g

export function topicMention(id: string, title: string) {
  const label = title.replace(/[[\]\r\n]/g, " ").trim() || "Untitled topic"
  return `[@${label}](edu-topic://${IdSchema.parse(id)})`
}

export function parseTopicMentions(text: string) {
  const mentions = []
  for (const match of text.matchAll(mentionPattern)) {
    const id = IdSchema.safeParse(match[2])
    if (!id.success) continue
    mentions.push({
      id: id.data,
      title: match[1],
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return mentions
}

export function stripTopicMentions(text: string) {
  return text.replace(mentionPattern, "@$1")
}
