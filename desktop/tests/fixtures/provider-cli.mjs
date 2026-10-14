#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const args = process.argv.slice(2)
if (process.env.EDU_TEST_CLI_FAIL_CONNECTION === "1" && args[0] !== "models" && args[0] !== "auth") process.exit(1)
if (args[0] === "auth") {
  const authFile = process.env.EDU_TEST_CLI_AUTH_FILE
  if (authFile && args[1] === "login") writeFileSync(authFile, "signed-in")
  if (authFile && !existsSync(authFile)) {
    console.log(JSON.stringify({ loggedIn: false, authMethod: "none" }))
    process.exit(1)
  }
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "learner@example.test" }))
} else if (args[0] === "models") {
  console.log("gemini-test  Gemini fixture model")
} else if (args[0] === "--print" && args[1] === "/usage") {
  console.log("Account quotas available")
} else if (args[0] === "inspect-environment") {
  console.log(JSON.stringify({ key: process.env.ANTHROPIC_API_KEY ?? null, gemini: process.env.GEMINI_API_KEY ?? null }))
} else {
  let input = readFileSync(0, "utf8")
  if (args.includes("--agent")) {
    const prompt = args.find((arg) => arg.startsWith("-p="))
    if (!prompt || input) throw new Error("Antigravity requires an attached print prompt and empty stdin")
    if (!readFileSync(".agents/agents/edu-tutor.md", "utf8").includes("tools: [finish]")) throw new Error("Antigravity requires finish for structured output")
    input = prompt.slice(3)
  }
  let action = { ready: true }
  if (input.includes("Suggested topic:\n"))
    action = { title: "Introduction to Limits" }
  const delimiter = "Conversation and tool results:\n"
  if (input.includes(delimiter)) {
    const transcript = JSON.parse(input.split(delimiter)[1])
    const results = transcript.filter((item) => item.tool)
    if (!results.length) action = { reply: "", calls: [{ name: "read_skill", arguments: JSON.stringify({ path: "references/FILE_STRUCTURE.md" }) }] }
    else if (!results.some((item) => item.tool === "save_learning_state" && !item.result.startsWith("Tool error:"))) {
      action = { reply: "", calls: [{ name: "save_learning_state", arguments: JSON.stringify({
        phase: "awaiting_plan_confirmation", outline: ["Limits"], currentSection: "",
        pendingQuestion: "", privateAnswerKey: "", nextAction: "Wait for confirmation",
        notes: "# Limits\n\nA proposed learning plan.", workpad: results.length === 1 ? "" : "Plan is awaiting confirmation.",
      }) }] }
    } else action = { reply: "Here is your learning plan. Confirm it to begin.", calls: [] }
    const request = transcript.findLast((item) => item.role === "user")?.content
    if (request === "Remember to explain in small steps across all my lessons.") {
      const memoryLine = input.split("\n").find((line) => line.startsWith("Workspace behaviour memory: "))
      const handoffLine = input.split("\n").find((line) => line.startsWith("Chat handoff: "))
      if (!memoryLine || !handoffLine) throw new Error("Missing tutor memory context")
      if (!results.some((item) => item.tool === "save_behaviour_memory" && !item.result.startsWith("Tool error:"))) {
        action = { reply: "", calls: [
          { name: "save_behaviour_memory", arguments: JSON.stringify({ expected: JSON.parse(memoryLine.slice("Workspace behaviour memory: ".length)), content: "# Tutor preferences\n\n## Explanation and pacing\n\nExplain in small steps." }) },
          { name: "save_learning_state", arguments: handoffLine.slice("Chat handoff: ".length) },
        ] }
      } else action = { reply: "I’ll explain in small steps.", calls: [] }
    } else if (request === "What tutor preference is saved?") {
      const memoryLine = input.split("\n").find((line) => line.startsWith("Workspace behaviour memory: "))
      const handoffLine = input.split("\n").find((line) => line.startsWith("Chat handoff: "))
      if (!memoryLine || !handoffLine) throw new Error("Missing tutor memory context")
      if (!results.some((item) => item.tool === "save_learning_state" && !item.result.startsWith("Tool error:")))
        action = { reply: "", calls: [{ name: "save_learning_state", arguments: handoffLine.slice("Chat handoff: ".length) }] }
      else action = { reply: `Saved tutor preferences:\n${JSON.parse(memoryLine.slice("Workspace behaviour memory: ".length))}`, calls: [] }
    }
  }
  if (args.includes("--agent")) console.log(JSON.stringify({ status: "SUCCESS", structured_output: action }))
  else console.log(JSON.stringify({ type: "result", is_error: false, structured_output: action }))
}
