export const scratchpadCommands = [
  { command: "/new-topic", type: "topic", label: "Topic", description: "Learn with a guided curriculum" },
  { command: "/new-test", type: "test", label: "Test", description: "Practice questions and test your understanding" },
  { command: "/new-generic", type: "generic", label: "Generic", description: "Explore a question or keep free notes" },
] as const

export function parseScratchpadCommand(text: string) {
  const match = scratchpadCommands.find(({ command }) =>
    text.startsWith(command) && (text.length === command.length || /\s/.test(text[command.length])),
  )
  if (!match) return
  return { command: match.command, type: match.type, instruction: text.slice(match.command.length).trim() }
}
