#!/usr/bin/env node
import { readFileSync } from "node:fs"

const args = process.argv.slice(2)
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "learner@example.test" }))
} else if (args[0] === "models") {
  console.log("gemini-test  Gemini fixture model")
} else if (args[0] === "inspect-environment") {
  console.log(JSON.stringify({ key: process.env.ANTHROPIC_API_KEY ?? null, gemini: process.env.GEMINI_API_KEY ?? null }))
} else {
  const input = readFileSync(0, "utf8")
  let action = { ready: true }
  const delimiter = "Conversation and tool results:\n"
  if (input.includes(delimiter)) {
    const transcript = JSON.parse(input.split(delimiter)[1])
    const results = transcript.filter((item) => item.tool)
    if (!results.length) action = { reply: "", calls: [{ name: "read_skill", arguments: JSON.stringify({ path: "references/FILE_STRUCTURE.md" }) }] }
    else if (!results.some((item) => item.tool === "save_learning_state" && !item.result.startsWith("Tool error:"))) {
      action = { reply: "", calls: [{ name: "save_learning_state", arguments: JSON.stringify({
        phase: "awaiting_plan_confirmation", outline: ["Limits"], currentSection: "",
        pendingQuestion: "", privateAnswerKey: "", nextAction: "Wait for confirmation",
        notes: results.length === 1 ? "" : "# Limits\n\nA proposed learning plan.", workpad: "Plan is awaiting confirmation.",
      }) }] }
    } else action = { reply: "Here is your learning plan. Confirm it to begin.", calls: [] }
  }
  if (args.includes("--agent")) console.log(JSON.stringify({ status: "SUCCESS", structured_output: action }))
  else console.log(JSON.stringify({ type: "result", is_error: false, structured_output: action }))
}
