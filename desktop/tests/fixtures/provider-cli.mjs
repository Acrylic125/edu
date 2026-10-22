#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs"

function nextAction(input) {
  let action = { ready: true }
  if (input.includes("Suggested topic:\n"))
    action = { title: "Introduction to Limits" }
  const delimiter = "Conversation and tool results:\n"
  if (input.includes(delimiter)) {
    const transcript = JSON.parse(input.split(delimiter)[1])
    const results = transcript.filter((item) => item.tool)
    if (!results.length) action = { reply: "", calls: [{ name: "read_skill", arguments: JSON.stringify({ path: "skills/MANAGE_TOPIC.md" }) }] }
    else if (!results.some((item) => item.tool === "save_learning_state" && !item.result.startsWith("Tool error:"))) {
      action = { reply: "", calls: [{ name: "save_learning_state", arguments: JSON.stringify({
        phase: "awaiting_plan_confirmation", outline: ["Limits"], currentSection: "",
        pendingQuestion: "", privateAnswerKey: "", nextAction: "Wait for confirmation",
        notes: "# Limits\n\nA proposed learning plan.", workpad: results.length === 1 ? "" : "Plan is awaiting confirmation.",
      }) }] }
    } else action = { reply: "Here is your learning plan. Confirm it to begin.", calls: [] }
    const request = transcript.findLast((item) => item.role === "user" && !item.content.startsWith("Internal app correction"))?.content
    const taggedLine = input.split("\n").find((line) => line.startsWith("Tagged scratchpads: "))
    const tagged = taggedLine ? JSON.parse(taggedLine.slice("Tagged scratchpads: ".length)) : []
    if (input.includes("Scratchpad creation requested: true") && !tagged.length) {
      let type = "topic"
      if (request?.includes("Test me on")) type = "test"
      else if (request?.includes("Keep free-form")) type = "generic"
      const materialsLine = input.split("\n").find((line) => line.startsWith("Chat materials: "))
      const materials = materialsLine ? JSON.parse(materialsLine.slice("Chat materials: ".length)) : []
      const references = materials.map((material) => {
        if (material.kind === "image") return { type: "image", path: `assets/${material.name}` }
        if (material.kind === "pdf") return { type: "pdf", path: `assets/${material.name}`, pages: [{ from: 1, to: material.pageCount }] }
        return { type: "other-file", path: `assets/${material.name}` }
      })
      const created = results.some((item) => ["topic_createTopic", "test_createTest", "generic_createGeneric"].includes(item.tool) && !item.result.startsWith("Tool error:"))
      if (!created) {
        let payload = { type, version: "19-10-2026", name: "Introduction to Limits", references }
        let name = "generic_createGeneric"
        let argumentsObject = { generic: payload }
        if (type === "topic") {
          const partReferences = references.length ? references : [{ type: "website", url: "https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function" }]
          payload = { type, version: "11-10-2026", name: "Introduction to Limits", content: [{ id: "tp-limits", name: "Limits", references: partReferences, goals: [{ objective: "Explain limits", understoodWhen: ["Explain nearby behavior"] }], mistakes: [] }] }
          name = "topic_createTopic"
          argumentsObject = { topic: payload }
        } else if (type === "test") {
          payload = { ...payload, goals: [], content: [], questions: [] }
          name = "test_createTest"
          argumentsObject = { test: payload }
        }
        action = { reply: "", calls: [{ name, arguments: JSON.stringify(argumentsObject) }] }
        const reads = []
        for (const material of materials) {
          const excerpts = results.filter((item) => item.tool === "read_material" && item.result.startsWith(`Source: ${material.name}\n`))
          let firstPage = 1
          while (firstPage <= material.pageCount && excerpts.some((item) => item.result.includes(`Page ${firstPage}\n`))) firstPage++
          if (firstPage <= material.pageCount) reads.push({ name: "read_material", arguments: JSON.stringify({ id: material.id, firstPage, lastPage: Math.min(firstPage + 14, material.pageCount) }) })
        }
        if (reads.length) action = { reply: "", calls: reads }
        if (request === "Help me learn calculus; propose a fresh plan.") {
          action.calls.unshift(
            { name: "topic_activatePart", arguments: JSON.stringify({ topicId: "scratchpad_1", topicPartId: "tp-limits" }) },
            { name: "topic_recordQuestion", arguments: JSON.stringify({ topicId: "scratchpad_1", topicPartId: "tp-limits", question: "What is a limit?" }) },
          )
        }
      } else if (!results.some((item) => item.tool === "save_learning_state" && !item.result.startsWith("Tool error:"))) {
        const handoffLine = input.split("\n").find((line) => line.startsWith("Chat handoff: "))
        const handoff = JSON.parse(handoffLine.slice("Chat handoff: ".length))
        handoff.workpad = "Created the scratchpad appropriate for the learner's request."
        if (type === "topic") handoff.phase = "awaiting_plan_confirmation"
        action = { reply: "", calls: [{ name: "save_learning_state", arguments: JSON.stringify(handoff) }] }
        if (request === "Help me learn calculus; propose a fresh plan.") {
          const result = results.find((item) => item.tool === "topic_createTopic" && !item.result.startsWith("Tool error:"))
          const topicId = JSON.parse(result.result).scratchpadId
          action.calls.unshift(
            { name: "topic_activatePart", arguments: JSON.stringify({ topicId, topicPartId: "tp-limits" }) },
            { name: "topic_recordQuestion", arguments: JSON.stringify({ topicId, topicPartId: "tp-limits", question: "What is a limit?" }) },
          )
        }
      } else action = { reply: "Here is your learning plan. Confirm it to begin.", calls: [] }
    }
    const structured = tagged.find((topic) => topic.state?.type === "topic" && topic.state.content.some((part) => part.id === "tp-structured-limits"))
    if (request === "Plan structured Limits curriculum." || (structured && request?.includes("I confirm this learning plan."))) {
      const topic = structured ?? tagged[0]
      const handoffLine = input.split("\n").find((line) => line.startsWith("Chat handoff: "))
      if (!topic || !handoffLine) throw new Error("Missing structured topic context")
      const handoff = JSON.parse(handoffLine.slice("Chat handoff: ".length))
      if (!results.some((item) => item.tool === "save_learning_state" && !item.result.startsWith("Tool error:"))) {
        let calls
        if (request === "Plan structured Limits curriculum.") {
          calls = [{ name: "topic_updateTopic", arguments: JSON.stringify({ topicId: topic.id, content: [{ id: "tp-structured-limits", name: "Limits", references: [{ type: "website", url: "https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function" }], goals: [{ objective: "Distinguish a limit from a function value", understoodWhen: ["Explain why a missing function value does not prevent a limit"] }], mistakes: [] }] }) }]
          handoff.phase = "awaiting_plan_confirmation"
        } else {
          calls = [
            { name: "topic_activatePart", arguments: JSON.stringify({ topicId: topic.id, topicPartId: "tp-structured-limits" }) },
            { name: "topic_updateTopic", arguments: JSON.stringify({ topicId: topic.id, summary: `# ${topic.title}

<topic-directory heading="Topic directory" items='[{"title":"Limits","anchor":"limits"}]' />

<a id="limits"></a>
## Limits

A function's limit describes its nearby behavior as the input approaches a point. The value at that point can differ, or be undefined.

## Topic terminology

| Term | Meaning / useful distinction |
|---|---|
| Limit | Value approached by nearby function values. |

## Materials` }) },
            { name: "topic_recordQuestion", arguments: JSON.stringify({ topicId: topic.id, topicPartId: "tp-structured-limits", question: "Why can a limit exist where the function is undefined?" }) },
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
    if (request === "A limit must equal the function value at the point.") {
      const topic = tagged[0]
      const question = "If the tank sensor has no reading at one instant, can nearby readings still approach one height?"
      const summary = "## Limits\n\nFor the water tank, distinguish its level at one instant from readings near that instant. Nearby readings can approach one height even if the sensor has no reading at the instant itself.\n\nSourced from: [OpenStax limits](https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function).\n\n## Topic terminology\n\n| Term | Meaning |\n|---|---|\n| Limit | Value approached by nearby function values. |\n| Function value | Output at the exact input, when defined. |"
      if (!results.some((item) => item.tool === "topic_recordAnswer" && !item.result.startsWith("Tool error:"))) {
        const handoffLine = input.split("\n").find((line) => line.startsWith("Chat handoff: "))
        const handoff = JSON.parse(handoffLine.slice("Chat handoff: ".length))
        action = { reply: "", calls: [
          { name: "topic_recordAnswer", arguments: JSON.stringify({ topicId: topic.id, topicPartId: "tp-structured-limits", stepIndex: 0, answerFromUser: request }) },
          { name: "topic_updateTopic", arguments: JSON.stringify({ topicId: topic.id, summary }) },
          { name: "topic_recordQuestion", arguments: JSON.stringify({ topicId: topic.id, topicPartId: "tp-structured-limits", question }) },
          { name: "save_learning_state", arguments: JSON.stringify({ ...handoff, phase: "awaiting_answer", pendingQuestion: question, privateAnswerKey: "The absent sensor reading does not determine the nearby behavior.", workpad: "Deliberating on the learner's proposed equality.", nextAction: "Wait for the learner to distinguish the exact reading from nearby readings." }) },
        ] }
      } else action = { reply: `Consider the missing sensor reading. ${question}`, calls: [] }
    }
    if (request === "Across all topics, what are the past mistakes I have made?") {
      const directoryLine = input.split("\n").find((line) => line.startsWith("Workspace scratchpad directory: "))
      const handoffLine = input.split("\n").find((line) => line.startsWith("Chat handoff: "))
      if (!directoryLine || !handoffLine) throw new Error("Missing workspace history context")
      const topics = JSON.parse(directoryLine.slice("Workspace scratchpad directory: ".length))
      const records = results.filter((item) => item.tool === "read_scratchpad" && !item.result.startsWith("Tool error:"))
      if (records.length < topics.length) {
        action = { reply: "", calls: topics.map((topic) => ({ name: "read_scratchpad", arguments: JSON.stringify({ scratchpadId: topic.id }) })) }
      } else if (!results.some((item) => item.tool === "save_learning_state" && !item.result.startsWith("Tool error:"))) {
        action = { reply: "", calls: [{ name: "save_learning_state", arguments: handoffLine.slice("Chat handoff: ".length) }] }
      } else {
        action = { reply: records.map((item) => { const record = JSON.parse(item.result); return `${record.title}: ${record.notes}` }).join("\n\n"), calls: [] }
      }
    }
  }
  return action
}

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
  console.log(JSON.stringify({ key: process.env.ANTHROPIC_API_KEY ?? null, gemini: process.env.GEMINI_API_KEY ?? null, grants: process.env.ANTIGRAVITY_PERM_GRANTS ?? null }))
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
  let server
  if (args.includes("--agent")) {
    const agent = readFileSync(".agents/agents/edu-tutor.md", "utf8")
    const configured = JSON.parse(agent.match(/^mcpServers: (.+)$/m)?.[1] ?? "[]")
    server = configured[0]
  } else {
    const index = args.indexOf("--mcp-config")
    if (index !== -1) server = JSON.parse(args[index + 1]).mcpServers.edu
  }
  let action
  if (server) {
    let sequence = 0
    const url = server.url ?? server.serverUrl
    async function request(method, params) {
      const response = await fetch(url, {
        method: "POST",
        headers: { ...server.headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params }),
      })
      if (!response.ok) throw new Error(`MCP HTTP ${response.status}`)
      const message = await response.json()
      if (message.error) throw new Error(message.error.message)
      return message.result
    }
    await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "provider-fixture", version: "1" } })
    const { tools } = await request("tools/list", {})
    if (!tools.some((tool) => tool.name === "save_learning_state")) throw new Error("EdU native tools were not discovered")
    const delimiter = "Conversation:\n"
    const [instructions, conversation] = input.split(delimiter)
    if (!conversation) throw new Error("Native turn requires conversation context")
    const transcript = JSON.parse(conversation.split("\nInternal app correction")[0])
    for (let iteration = 0; iteration < 20; iteration++) {
      const legacyInput = `${instructions}Conversation and tool results:\n${JSON.stringify(transcript)}`
      action = nextAction(legacyInput)
      if (!action.calls?.length) break
      transcript.push(action)
      for (const call of action.calls) {
        const result = await request("tools/call", { name: call.name, arguments: JSON.parse(call.arguments) })
        transcript.push({ tool: call.name, result: result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n") })
      }
    }
    if (action.calls?.length) throw new Error("Fixture reached its native tool limit")
    action = { reply: action.reply }
  } else action = nextAction(input)
  if (args.includes("--agent")) console.log(JSON.stringify({ status: "SUCCESS", structured_output: action }))
  else console.log(JSON.stringify({ type: "result", is_error: false, structured_output: action }))
}
