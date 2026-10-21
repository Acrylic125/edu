import { expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { parseScratchpadCommand } from "../src/shared/scratchpad-commands"
import { SendSchema } from "../src/shared/contracts"
import { mostRecentTopic } from "../src/shared/recent-topic"
import { newChat, newTopic } from "../src/main/workspace"
import { GenericStateSchema, TestStateSchema } from "../src/shared/scratchpad-state"

test.each(["topic", "test", "generic"])("recognizes a leading /new-%s and its instruction", (type) => {
  expect(parseScratchpadCommand(`/new-${type} Explain limits`)).toEqual({ command: `/new-${type}`, type, instruction: "Explain limits" })
  expect(parseScratchpadCommand(`/new-${type}\nExplain limits`)?.instruction).toBe("Explain limits")
  expect(parseScratchpadCommand(`/new-${type}`)?.instruction).toBe("")
})

test.each([" /new-topic limits", "\n/new-test limits", "Please /new-generic notes", "/new-topics limits", "/new-test!", "/NEW-TEST limits"])("treats %j as ordinary text", (text) => {
  expect(parseScratchpadCommand(text)).toBeUndefined()
})

test("send validation preserves leading whitespace so ordinary text cannot become a command", () => {
  const content = " /new-test limits "
  expect(SendSchema.parse({ chatId: randomUUID(), content }).content).toBe(content)
  expect(SendSchema.safeParse({ chatId: randomUUID(), content: " \n " }).success).toBe(false)
})

test("test preset uses the latest message in a topic's thread, ignoring newer test/generic threads", () => {
  const calculus = newTopic("Calculus")
  const automata = newTopic("Automata")
  const testPad = newTopic("Practice")
  testPad.state = TestStateSchema.parse({ type: "test", version: "19-10-2026", name: "Practice", createdAt: testPad.createdAt, goals: [], questions: [], content: [], references: [] })
  const notes = newTopic("Notes")
  notes.state = GenericStateSchema.parse({ type: "generic", version: "19-10-2026", name: "Notes", createdAt: notes.createdAt, references: [] })
  const chats = [calculus, automata, testPad, notes].map((topic, index) => {
    const chat = newChat(randomUUID())
    chat.messages.push({ id: randomUUID(), role: "user", content: "Hello", topicIds: [topic.id], createdAt: `2026-10-2${index}T00:00:00.000Z` })
    return chat
  })
  const topics = [calculus, automata, testPad, notes]
  expect(mostRecentTopic({ topics, chats })?.id).toBe(automata.id)
  chats[0].messages.push({ id: randomUUID(), role: "assistant", content: "Continue", topicIds: [], createdAt: "2026-10-25T00:00:00.000Z" })
  expect(mostRecentTopic({ topics, chats })?.id).toBe(calculus.id)
  expect(mostRecentTopic({ topics, chats: [] })).toBeUndefined()
  expect(mostRecentTopic({ topics: [testPad, notes], chats })).toBeUndefined()
})
