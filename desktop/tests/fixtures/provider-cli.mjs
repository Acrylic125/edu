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
  if (input.includes("Hold concurrent turn")) await new Promise((resolve) => setTimeout(resolve, 60_000))
  if (args.includes("--agent")) {
    const prompt = args.find((arg) => arg.startsWith("-p="))
    if (!prompt || input) throw new Error("Antigravity requires an attached print prompt and empty stdin")
    const nativeTools = readFileSync(".agents/agents/edu-tutor.md", "utf8").match(/^tools: \[([^\]]+)\]/m)?.[1].split(",").map((tool) => tool.trim()) ?? []
    if (!nativeTools.includes("finish")) throw new Error("Antigravity requires finish for structured output")
    if (nativeTools.some((tool) => !["finish", "search_web", "read_url_content"].includes(tool))) throw new Error("Unexpected Antigravity tool")
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
    const taggedLine = input.split("\n").find((line) => line.startsWith("Tagged topics: "))
    const tagged = taggedLine ? JSON.parse(taggedLine.slice("Tagged topics: ".length)) : []
    const structured = tagged.find((topic) => topic.state?.content.some((part) => part.id === "tp-structured-limits"))
    if (request === "Plan structured Limits curriculum." || (structured && request?.includes("I confirm this learning plan."))) {
      const topic = structured ?? tagged[0]
      const handoffLine = input.split("\n").find((line) => line.startsWith("Chat handoff: "))
      if (!topic || !handoffLine) throw new Error("Missing structured topic context")
      const handoff = JSON.parse(handoffLine.slice("Chat handoff: ".length))
      if (!results.some((item) => item.tool === "save_learning_state" && !item.result.startsWith("Tool error:"))) {
        let calls
        if (request === "Plan structured Limits curriculum.") {
          calls = [{ name: "updateTopic", arguments: JSON.stringify({ topicId: topic.id, content: [{ id: "tp-structured-limits", name: "Limits", references: [{ type: "website", url: "https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function" }], goals: { id: "tpg-structured-limits", objective: "Distinguish a limit from a function value", understoodWhen: ["Explain why a missing function value does not prevent a limit"] }, mistakes: [] }] }) }]
          handoff.phase = "awaiting_plan_confirmation"
        } else {
          calls = [
            { name: "activatePart", arguments: JSON.stringify({ topicId: topic.id, topicPartId: "tp-structured-limits" }) },
            { name: "updateTopic", arguments: JSON.stringify({ topicId: topic.id, summary: `# ${topic.title}

<topic-directory heading="Topic directory" items='[{"title":"Limits","anchor":"limits"}]' />

<a id="limits"></a>
## Limits

A function's limit describes its nearby behavior as the input approaches a point. The value at that point can differ, or be undefined.

## Topic terminology

| Term | Meaning / useful distinction |
|---|---|
| Limit | Value approached by nearby function values. |

## Materials` }) },
            { name: "recordQuestion", arguments: JSON.stringify({ topicId: topic.id, topicPartId: "tp-structured-limits", question: "Why can a limit exist where the function is undefined?" }) },
          ]
          handoff.phase = "awaiting_answer"
          handoff.pendingQuestion = "Why can a limit exist where the function is undefined?"
          handoff.privateAnswerKey = "A limit concerns nearby values rather than the function value at the point."
        }
        calls.push({ name: "save_learning_state", arguments: JSON.stringify(handoff) })
        action = { reply: "", calls }
      } else {
        action = { reply: topic.planConfirmed ? "Why can a limit exist where the function is undefined?" : "Review the Limits curriculum.", calls: [] }
      }
    }
    if (request === "Across all topics, what are the past mistakes I have made?") {
      const directoryLine = input.split("\n").find((line) => line.startsWith("Workspace topic directory: "))
      const handoffLine = input.split("\n").find((line) => line.startsWith("Chat handoff: "))
      if (!directoryLine || !handoffLine) throw new Error("Missing workspace history context")
      const topics = JSON.parse(directoryLine.slice("Workspace topic directory: ".length))
      const records = results.filter((item) => item.tool === "read_topic_notes" && !item.result.startsWith("Tool error:"))
      if (records.length < topics.length) {
        action = { reply: "", calls: topics.map((topic) => ({ name: "read_topic_notes", arguments: JSON.stringify({ topicId: topic.id }) })) }
      } else if (!results.some((item) => item.tool === "save_learning_state" && !item.result.startsWith("Tool error:"))) {
        action = { reply: "", calls: [{ name: "save_learning_state", arguments: handoffLine.slice("Chat handoff: ".length) }] }
      } else {
        action = { reply: records.map((item) => { const record = JSON.parse(item.result); return `${record.title}: ${record.notes}` }).join("\n\n"), calls: [] }
      }
    }
  }
  if (args.includes("--agent")) console.log(JSON.stringify({ status: "SUCCESS", structured_output: action }))
  else console.log(JSON.stringify({ type: "result", is_error: false, structured_output: action }))
}
