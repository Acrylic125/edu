import type { Chat } from "./contracts"

export function messageText(message: Pick<Chat["messages"][number], "content" | "responseQuestion">) {
  if (!message.responseQuestion) return message.content
  return `${message.content}\n\n${message.responseQuestion.prompt}\n${message.responseQuestion.options.map((option) => `- ${option}`).join("\n")}`
}
