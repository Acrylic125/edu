import { nanoid } from "nanoid"

export type TopicId = string
export type MessageId = string

export function clientMessageId(): MessageId {
  return nanoid()
}
