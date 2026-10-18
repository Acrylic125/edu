import { randomUUID } from "node:crypto"
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"
import { afterEach, expect, test, vi } from "vitest"
import { CodexAppServer } from "../src/providers/codex-rpc"
import { CodexProvider, readCodexModels } from "../src/providers/codex"
import { ProviderRegistry } from "../src/providers/registry"
import { shell } from "electron"
import { runCodexTutorTurn } from "../src/runners/codex"
import { generateTopicTitle } from "../src/runners/title"
import { createTutorSession } from "../src/runners/tutor"
import { newChat } from "../src/main/workspace"
import { WorkerJobSchema, WorkspaceSchema } from "../src/shared/contracts"
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base"
import { TurnTelemetry } from "../src/runners/telemetry"
import { createCanvas } from "@napi-rs/canvas"

const directories: string[] = []
const clients: CodexAppServer[] = []
vi.mock("electron", () => ({ shell: { openExternal: vi.fn().mockResolvedValue(undefined) }, safeStorage: {} }))
afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
async function directory() {
  const value = await mkdtemp(join(tmpdir(), "prune-codex-"))
  directories.push(value)
  return value
}

test("Codex enables live web research while keeping shell access disabled", async () => {
  const { job, home } = await fixture()
  if (!job.codex) throw new Error("Missing Codex fixture")
  const client = new CodexAppServer(job.codex, home)
  clients.push(client)
  await client.initialize()
  expect(client.child.spawnargs).toContain('web_search="live"')
  expect(client.child.spawnargs).toContain("shell_tool")
  expect(client.child.spawnargs).toContain("unified_exec")
})

test.each([false, true])("Codex receives attached screenshot pixels directly when resumed=%s", async (resumed) => {
  const { job, home } = await fixture()
  if (!job.codex) throw new Error("Missing Codex fixture")
  if (resumed) job.chat.providerSession = { provider: "codex", threadId: "thread", home: job.codex.home, executable: job.codex.executable, toolVersion: 14, status: "ready" }
  await mkdir(job.assetDirectory, { recursive: true })
  const material = { id: randomUUID(), name: "screenshot.png", kind: "image" as const, text: "Image source. Use read_material to inspect the image visually.", pages: [] }
  await writeFile(join(job.assetDirectory, material.name), createCanvas(80, 40).toBuffer("image/png"))
  job.chat.materials.push(material)
  job.chat.messages[0].materialIds = [material.id]
  await runCodexTutorTurn(job, () => {}, () => {})
  const requests = (await readFile(join(home, "requests.jsonl"), "utf8")).trim().split("\n")
    .map((line) => z.object({ method: z.string().optional(), params: z.json().optional() }).parse(JSON.parse(line)))
  const turn = z.object({ input: z.array(z.object({ type: z.string(), text: z.string().optional(), url: z.string().optional() })) }).parse(requests.find((request) => request.method === "turn/start")?.params)
  expect(turn.input.some((item) => item.type === "image" && item.url?.startsWith("data:image/png;base64,"))).toBe(true)
  expect(turn.input.some((item) => item.text?.includes(`prune-source://${material.id}/1`))).toBe(true)
})

async function fixture(mode = "completed") {
  const home = await directory()
  const executable = join(home, "codex-fixture.mjs")
  const runner = {
    id: randomUUID(),
    name: "Codex tutor",
    provider: "codex",
    model: "test-model",
    reasoningEffort: "high",
  }
  const chat = newChat(runner.id)
  chat.messages.push({
    id: randomUUID(),
    role: "user",
    content: "Propose a plan",
    createdAt: new Date().toISOString(),
    topicIds: [],
  })
  const job = WorkerJobSchema.parse({
    chat,
    topics: [],
    runner,
    codex: { home: join(home, "providers", "codex"), executable },
    skillDirectory: resolve("resources/tutor-me"),
    assetDirectory: join(home, "chats", chat.id, "assets"),
  })
  await writeFile(
    join(home, "state.json"),
    JSON.stringify({
      ...chat.learning,
      outline: ["Limits", "Derivatives"],
      notes: "# Limits\n\nDraft outline.",
      workpad: "Waiting for plan confirmation.",
    }),
  )
  await writeFile(
    executable,
    `#!${process.execPath}
import { createInterface } from "node:readline"
import { readFileSync, appendFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const home=dirname(fileURLToPath(import.meta.url))
writeFileSync(join(home,"runtime.json"),JSON.stringify({cwd:process.cwd(),home:process.env.CODEX_HOME}))
let account=null
let turns=0
const send=value=>process.stdout.write(JSON.stringify(value)+"\\n")
createInterface({input:process.stdin}).on("line",line=>{
 const message=JSON.parse(line)
 appendFileSync(join(home,"requests.jsonl"),line+"\\n")
 if(message.method==="initialize") send({id:message.id,result:{userAgent:"fixture"}})
 else if(message.method==="account/read") send({id:message.id,result:{account}})
 else if(message.method==="account/login/start") {
  const respond=()=>send({id:message.id,result:{type:"chatgpt",loginId:"login",authUrl:"https://auth.openai.com/authorize?client=fixture"}})
  if(${JSON.stringify(mode)}==="delayed-login") setTimeout(respond,100)
  else respond()
  if(${JSON.stringify(mode)}==="login") setTimeout(()=>{
   account={type:"chatgpt",email:"learner@example.com",planType:"plus"}
   send({method:"account/login/completed",params:{loginId:"login",success:true,error:null}})
  },100)
 } else if(message.method==="account/logout") {account=null;send({id:message.id,result:{}})}
 else if(message.method==="account/login/cancel") send({id:message.id,result:{status:"canceled"}})
 else if(message.method==="model/list") send({id:message.id,result:{data:[{model:"test-model",displayName:"Fixture model",isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"medium"},{reasoningEffort:"high"}]},...(${JSON.stringify(mode)}.startsWith("title")?[{model:"gpt-6-luna",displayName:"GPT-6 Luna",supportedReasoningEfforts:[{reasoningEffort:"low"},{reasoningEffort:"none"}]}]:[])],nextCursor:null}})
 else if(message.method==="thread/start") send({id:message.id,result:{thread:{id:"thread"}}})
 else if(message.method==="thread/resume") {
  if(${JSON.stringify(mode)}==="resume-missing") send({id:message.id,error:{code:-32000,message:"Thread not found"}})
  else if(${JSON.stringify(mode)}==="resume-network") send({id:message.id,error:{code:-32000,message:"Provider temporarily unavailable"}})
  else send({id:message.id,result:{thread:{id:"thread"}}})
 }
 else if(message.method==="turn/start") {
  turns++
  send({id:message.id,result:{turn:{id:"turn"}}})
  if(${JSON.stringify(mode)}.startsWith("title")) {
   send({method:"item/completed",params:{threadId:"other-thread",item:{type:"agentMessage",text:'{"title":"Wrong thread"}'}}})
   send({method:"item/completed",params:{threadId:"thread",item:{type:"agentMessage",phase:"commentary",text:"Preparing a title"}}})
   send({method:"item/completed",params:{threadId:"thread",item:{type:"agentMessage",phase:"final_answer",text:${JSON.stringify(mode === "title-empty" ? '{"title":""}' : '{"title":"Introduction to Calculus"}')}}}})
   send({method:"turn/completed",params:{threadId:"thread",turn:{status:${JSON.stringify(mode === "title-failed" ? "failed" : "completed")}}}})
   return
  }
  if((${JSON.stringify(mode)}==="missed-save" && turns===1) || ${JSON.stringify(mode)}==="never-save") {
   send({method:"item/completed",params:{threadId:"thread",item:{type:"agentMessage",phase:"final_answer",text:"Here is your proposed plan. Please review it."}}})
   send({method:"turn/completed",params:{threadId:"thread",turn:{status:"completed",error:null}}})
   return
  }
  const state=JSON.parse(readFileSync(join(home,"state.json"),"utf8"))
  if(${JSON.stringify(mode)}==="invalid-save" || (${JSON.stringify(mode)}==="corrected-save" && turns===1)) state.workpad=""
  send({id:"tool-call",method:"item/tool/call",params:{threadId:"thread",turnId:"turn",callId:"call",tool:"save_learning_state",arguments:state}})
 } else if(message.id==="tool-call") {
  let text="Here is your proposed plan. Please review it."
  if(${JSON.stringify(mode)}==="missing-reply" && turns===1) text=""
  send({method:"item/started",params:{threadId:"thread",item:{id:"comment",type:"agentMessage",phase:"commentary"}}})
  send({method:"item/agentMessage/delta",params:{threadId:"thread",itemId:"comment",delta:"Private commentary"}})
  send({method:"item/started",params:{threadId:"thread",item:{id:"answer",type:"agentMessage",phase:"final_answer"}}})
  send({method:"item/agentMessage/delta",params:{threadId:"other-thread",itemId:"answer",delta:"Wrong thread"}})
  send({method:"item/agentMessage/delta",params:{threadId:"thread",itemId:"answer",delta:text.slice(0,12)}})
  send({method:"item/agentMessage/delta",params:{threadId:"thread",itemId:"answer",delta:text.slice(12)}})
  send({method:"item/completed",params:{threadId:"thread",item:{type:"agentMessage",phase:"final_answer",text}}})
  send({method:"turn/completed",params:{threadId:"thread",turn:{status:${JSON.stringify(mode === "failed" ? "failed" : "completed")},error:${mode === "failed" ? '{message:"Provider request failed"}' : "null"}}}})
 } else if(message.method==="echo") setTimeout(()=>send({id:message.id,result:message.params}),message.params.delay)
 else if(message.method==="invalid") process.stdout.write("invalid JSON\\n")
})
`,
    { mode: 0o700 },
  )
  return { job, home }
}

test("native Codex tool spans remain children of the agent runner span", async () => {
  const { job, home } = await fixture()
  const exporter = new InMemorySpanExporter()
  const telemetry = new TurnTelemetry({ directory: home, name: "test", exporter })
  await runCodexTutorTurn(job, () => {}, () => {}, () => {}, telemetry)
  const spans = exporter.getFinishedSpans()
  const agent = spans.find((span) => span.name === "runner.codex")!
  const tool = spans.find((span) => span.name === "save_learning_state")!
  expect(tool.parentSpanContext?.spanId).toBe(agent.spanContext().spanId)
  expect(agent.attributes["openinference.span.kind"]).toBe("AGENT")
  await telemetry.finish()
})

test("bundled Codex initializes, reads an isolated account, and discovers models without a CLI installation", async () => {
  const home = await directory()
  const client = new CodexAppServer({
    home,
    executable: resolve(
      "resources/codex/bin",
      process.platform === "win32" ? "codex.exe" : "codex",
    ),
  })
  clients.push(client)
  expect(client.child.spawnargs).toContain("code_mode_host")
  const hostFlag = client.child.spawnargs.indexOf("code_mode_host")
  expect(client.child.spawnargs[hostFlag - 1]).toBe("--enable")
  await access(
    resolve(
      "resources/codex/bin",
      process.platform === "win32"
        ? "codex-code-mode-host.exe"
        : "codex-code-mode-host",
    ),
  )
  await client.initialize()
  const result = await client.request(
    "account/read",
    { refreshToken: false },
    z.object({ account: z.object({}).nullable() }),
  )
  expect(result.account).toBeNull()
  const models = await readCodexModels(client)
  expect(models.length).toBeGreaterThan(0)
  const model = models.find((model) => model.isDefault) ?? models[0]
  const { job } = await fixture()
  const session = await createTutorSession(job, () => {})
  const thread = await client.request(
    "thread/start",
    {
      model: model.id,
      sandbox: "read-only",
      approvalPolicy: "never",
      ephemeral: false,
      baseInstructions: session.instructions,
      dynamicTools: session.tools.map((tool) => {
        if (tool.type !== "function")
          throw new Error("Unsupported fixture tool")
        return {
          type: "function",
          name: tool.function.name,
          description: tool.function.description ?? "",
          inputSchema: z.json().parse(tool.function.parameters),
        }
      }),
    },
    z.object({ thread: z.object({ id: z.string() }) }),
  )
  expect(thread.thread.id).not.toBe("")
  await client.request("thread/inject_items", {
    threadId: thread.thread.id,
    items: [{ type: "message", role: "user", content: [{ type: "input_text", text: "A locally persisted conversation fixture." }] }],
  }, z.object({}).passthrough())
  client.close()
  const resumedClient = new CodexAppServer({ home, executable: resolve("resources/codex/bin", process.platform === "win32" ? "codex.exe" : "codex") })
  clients.push(resumedClient)
  await resumedClient.initialize()
  const resumed = await resumedClient.request("thread/resume", {
    threadId: thread.thread.id,
    baseInstructions: session.instructions,
    approvalPolicy: "never",
    sandbox: "read-only",
    excludeTurns: true,
  }, z.object({ thread: z.object({ id: z.string() }) }))
  expect(resumed.thread.id).toBe(thread.thread.id)
}, 45_000)

test("Codex uses Tutor Me tool validation and returns a saved plan only after turn completion", async () => {
  const { job, home } = await fixture()
  const processes: (number | null)[] = []
  const nodes: string[] = []
  const result = await runCodexTutorTurn(
    job,
    () => {},
    (pid) => processes.push(pid),
    (event, details) => {
      if (event === "graph.node" && typeof details.node === "string") nodes.push(details.node)
    },
  )
  expect(nodes).toContain("agent")
  expect(nodes.at(-1)).toBe("finish")
  expect(result.learning.outline).toEqual(["Limits", "Derivatives"])
  expect(result.learning.workpad).toBe("Waiting for plan confirmation.")
  expect(result.reply).toContain("review")
  expect(processes[0]).toBeGreaterThan(0)
  expect(processes.at(-1)).toBeNull()
  const requests = (await readFile(join(home, "requests.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) =>
      z
        .object({ method: z.string().optional(), params: z.json().optional() })
        .parse(JSON.parse(line)),
    )
  const thread = z
    .object({
      baseInstructions: z.string(),
      dynamicTools: z.array(z.object({ name: z.string() })),
      sandbox: z.string(),
      cwd: z.string(),
    })
    .parse(requests.find((entry) => entry.method === "thread/start")?.params)
  expect(thread.baseInstructions).toContain("Chat handoff")
  expect(thread.dynamicTools.map((tool) => tool.name)).toEqual([
    "read_skill",
    "read_material",
    "read_topic_notes",
    "activatePart",
    "complete",
    "documentMistake",
    "recordQuestion",
    "recordAnswer",
    "updateTopic",
    "createTopic",
    "getMistakesForTopic",
    "whereAmI",
    "getTopicProgress",
    "whatIsNext",
    "getQuestions",
    "save_learning_state",
  ])
  expect(thread.sandbox).toBe("read-only")
  const runtime = z
    .object({ cwd: z.string(), home: z.string() })
    .parse(JSON.parse(await readFile(join(home, "runtime.json"), "utf8")))
  expect(runtime.cwd).toBe(await realpath(dirname(job.assetDirectory)))
  expect(await realpath(thread.cwd)).toBe(runtime.cwd)
  expect(runtime.home).toBe(job.codex?.home)
  expect(runtime.cwd).not.toContain("providers")
})

test("Codex cannot publish a rejected save or a failed turn", async () => {
  const invalid = await fixture("invalid-save")
  await expect(
    runCodexTutorTurn(
      invalid.job,
      () => {},
      () => {},
    ),
  ).rejects.toThrow("A private handoff and a concrete next action are required")
  const failed = await fixture("failed")
  await expect(
    runCodexTutorTurn(
      failed.job,
      () => {},
      () => {},
    ),
  ).rejects.toThrow("Provider request failed")
})

test("Codex recovers when a completed reply omits the required learning-state save", async () => {
  const { job, home } = await fixture("missed-save")
  const result = await runCodexTutorTurn(
    job,
    () => {},
    () => {},
  )
  expect(result.learning.outline).toEqual(["Limits", "Derivatives"])
  expect(result.reply).toContain("review")
  const requests = (await readFile(join(home, "requests.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) =>
      z.object({ method: z.string().optional() }).parse(JSON.parse(line)),
    )
  expect(
    requests.filter((request) => request.method === "turn/start"),
  ).toHaveLength(2)
  expect(
    requests.filter((request) => request.method === "thread/start"),
  ).toHaveLength(1)
})

test("Codex retries a rejected save with its validation feedback", async () => {
  const { job, home } = await fixture("corrected-save")
  const result = await runCodexTutorTurn(
    job,
    () => {},
    () => {},
  )
  expect(result.learning.workpad).toBe("Waiting for plan confirmation.")
  const requests = (await readFile(join(home, "requests.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) =>
      z
        .object({ method: z.string().optional(), params: z.json().optional() })
        .parse(JSON.parse(line)),
    )
  const turns = requests.filter((request) => request.method === "turn/start")
  expect(turns).toHaveLength(2)
  expect(JSON.stringify(turns[1].params)).toContain(
    "A private handoff and a concrete next action are required",
  )
})

test("Codex completes a saved state that has no learner-facing reply", async () => {
  const { job } = await fixture("missing-reply")
  const result = await runCodexTutorTurn(
    job,
    () => {},
    () => {},
  )
  expect(result.learning.outline).toEqual(["Limits", "Derivatives"])
  expect(result.reply).toContain("review")
})

test("Codex bounds recovery when it repeatedly omits the learning-state save", async () => {
  const { job, home } = await fixture("never-save")
  await expect(
    runCodexTutorTurn(
      job,
      () => {},
      () => {},
    ),
  ).rejects.toThrow("did not save a complete learning state")
  const requests = (await readFile(join(home, "requests.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) =>
      z.object({ method: z.string().optional() }).parse(JSON.parse(line)),
    )
  expect(
    requests.filter((request) => request.method === "turn/start"),
  ).toHaveLength(3)
})

test("Codex RPC correlates out-of-order responses and rejects malformed wire data", async () => {
  const { job, home } = await fixture()
  if (!job.codex) throw new Error("Missing fixture connection")
  const client = new CodexAppServer(job.codex, home)
  clients.push(client)
  await client.initialize()
  const results = await Promise.all([
    client.request(
      "echo",
      { delay: 30, value: "first" },
      z.object({ value: z.string() }),
    ),
    client.request(
      "echo",
      { delay: 0, value: "second" },
      z.object({ value: z.string() }),
    ),
  ])
  expect(results.map((item) => item.value)).toEqual(["first", "second"])
  await expect(client.request("invalid", {}, z.object({}))).rejects.toThrow(
    "invalid protocol",
  )
})

test("existing runners default to ChatGPT when provider metadata is introduced", () => {
  const id = randomUUID()
  const workspace = WorkspaceSchema.parse({
    version: 2,
    runners: [{ id, name: "Existing tutor", model: "openrouter/auto" }],
    topics: [],
    chats: [],
  })
  expect(workspace.runners[0]).toMatchObject({ provider: "codex", model: "gpt-6-luna" })
})

test("Codex sign-in updates the provider account and logout clears it", async () => {
  const { job } = await fixture("login")
  if (!job.codex) throw new Error("Missing fixture connection")
  const urls: string[] = []
  const provider = new CodexProvider(
    job.codex,
    () => {},
    async (url) => {
      urls.push(url)
    },
  )
  try {
    await provider.refresh()
    expect(provider.state.connected).toBe(false)
    await provider.connect()
    expect(provider.state.connecting).toBe(true)
    expect(urls).toEqual(["https://auth.openai.com/authorize?client=fixture"])
    await vi.waitFor(() => {
      expect(provider.state.connected).toBe(true)
      expect(provider.state.account).toBe("learner@example.com")
    })
    await provider.disconnect()
    expect(provider.state.connected).toBe(false)
    expect(provider.state.account).toBeUndefined()
  } finally {
    provider.close()
  }
})

test.each(["connect", "refresh"] as const)("Codex %s recreates a closed provider with the same configuration", async (operation) => {
  const { job, home } = await fixture()
  if (!job.codex) throw new Error("Missing fixture connection")
  const registry = new ProviderRegistry(home, "unused", () => {}, [{
    id: "codex", displayName: "ChatGPT", binaryPath: job.codex.executable, enabled: true,
  }])
  const previous = registry.codex
  try {
    await registry.connect("codex")
    expect(previous.state.connecting).toBe(true)
    previous.close()
    vi.mocked(shell.openExternal).mockClear()
    await registry[operation]("codex")
    expect(registry.codex).not.toBe(previous)
    expect(registry.codex.connection).toEqual(previous.connection)
    if (operation === "connect") {
      expect(registry.codex.state.connecting).toBe(true)
      expect(shell.openExternal).toHaveBeenCalledTimes(1)
      expect(shell.openExternal).toHaveBeenCalledWith("https://auth.openai.com/authorize?client=fixture")
    } else {
      expect(registry.codex.state.error).toBeUndefined()
      expect(registry.codex.state.models[0]?.id).toBe("test-model")
    }
  } finally {
    registry.close()
  }
})

test("Refresh reconciles a provider closed while its previous check is pending", async () => {
  const { job, home } = await fixture()
  if (!job.codex) throw new Error("Missing fixture connection")
  const registry = new ProviderRegistry(home, job.codex.executable, () => {})
  try {
    const checking = registry.refresh("codex")
    const previous = registry.codex
    previous.close()
    await registry.refresh("codex")
    await checking
    expect(registry.codex).not.toBe(previous)
    expect(registry.codex.state.error).toBeUndefined()
    expect(registry.codex.state.models[0]?.id).toBe("test-model")
  } finally {
    registry.close()
  }
})

test("a closed registry rejects Connect without reviving Codex", async () => {
  const registry = new ProviderRegistry("/unused", "unused", () => {})
  const previous = registry.codex
  registry.close()
  await expect(registry.connect("codex")).rejects.toThrow("shutting down")
  await registry.refresh("codex")
  expect(registry.codex).toBe(previous)
})

test("Connect waiting for a check cannot revive Codex after shutdown", async () => {
  const registry = new ProviderRegistry("/unused", "unused", () => {})
  let finish = () => {}
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const refresh = vi.spyOn(registry.codex, "refresh").mockReturnValue(pending)
  try {
    const checking = registry.refresh("codex")
    const connecting = registry.connect("codex")
    registry.close()
    finish()
    await checking
    await expect(connecting).rejects.toThrow("shutting down")
  } finally {
    refresh.mockRestore()
    registry.close()
  }
})

test("Codex cancels pending sign-in and closes safely during initialization", async () => {
  const { job, home } = await fixture()
  if (!job.codex) throw new Error("Missing fixture connection")
  const provider = new CodexProvider(
    job.codex,
    () => {},
    async () => {},
  )
  try {
    const connecting = provider.connect()
    await expect(provider.connect()).rejects.toThrow("already open")
    await connecting
    await provider.cancel()
    expect(provider.state.connecting).toBe(false)
    expect(await readFile(join(home, "requests.jsonl"), "utf8")).toContain(
      '"method":"account/login/cancel"',
    )
  } finally {
    provider.close()
  }
  const closing = new CodexProvider(
    job.codex,
    () => {},
    async () => {},
  )
  const starting = closing.connect()
  closing.close()
  await expect(starting).rejects.toThrow("closed")
})

test("canceling while Codex creates a login prevents opening the browser", async () => {
  const { job, home } = await fixture("delayed-login")
  if (!job.codex) throw new Error("Missing fixture connection")
  const urls: string[] = []
  const provider = new CodexProvider(
    job.codex,
    () => {},
    async (url) => {
      urls.push(url)
    },
  )
  try {
    await provider.refresh()
    const connecting = provider.connect()
    await vi.waitFor(async () => {
      expect(await readFile(join(home, "requests.jsonl"), "utf8")).toContain(
        '"method":"account/login/start"',
      )
    })
    await provider.cancel()
    await connecting
    expect(urls).toEqual([])
    expect(provider.state.connecting).toBe(false)
    expect(await readFile(join(home, "requests.jsonl"), "utf8")).toContain(
      '"method":"account/login/cancel"',
    )
  } finally {
    provider.close()
  }
})

test("topic titles use Luna with minimal reasoning independently of the tutor model", async () => {
  const { job, home } = await fixture("title")
  const processes: (number | null)[] = []
  const title = await generateTopicTitle(job, job.chat.messages.find((message) => message.role === "user")?.content ?? "", (pid) => processes.push(pid), () => {})
  expect(title).toBe("Introduction to Calculus")
  expect(job.runner.model).toBe("test-model")
  expect(job.runner.reasoningEffort).toBe("high")
  expect(processes[0]).toBeGreaterThan(0)
  expect(processes.at(-1)).toBeNull()
  const requests = (await readFile(join(home, "requests.jsonl"), "utf8"))
    .trim().split("\n")
    .map((line) => z.object({ method: z.string().optional(), params: z.json().optional() }).parse(JSON.parse(line)))
  expect(requests.find((request) => request.method === "thread/start")?.params).toMatchObject({
    model: "gpt-6-luna", ephemeral: true, dynamicTools: [],
  })
  expect(requests.find((request) => request.method === "turn/start")?.params).toMatchObject({ effort: "none" })
})

test.each(["title-failed", "title-empty"])("rejects invalid title results and closes the Codex process: %s", async (mode) => {
  const { job } = await fixture(mode)
  const processes: (number | null)[] = []
  await expect(generateTopicTitle(job, job.chat.messages.find((message) => message.role === "user")?.content ?? "", (pid) => processes.push(pid), () => {})).rejects.toThrow()
  expect(processes.at(-1)).toBeNull()
})

test("does not use an expensive tutor model when no budget Codex model is available", async () => {
  const { job, home } = await fixture()
  await expect(generateTopicTitle(job, job.chat.messages.find((message) => message.role === "user")?.content ?? "", () => {}, () => {})).rejects.toThrow("No budget title model")
  expect(await readFile(join(home, "requests.jsonl"), "utf8")).not.toContain('"method":"thread/start"')
})


test("resumes the native Codex thread after restart and sends only the new request", async () => {
  const { job, home } = await fixture()
  const first = await runCodexTutorTurn(job, () => {}, () => {})
  expect(first.providerSession.status).toBe("ready")
  job.chat.providerSession = first.providerSession
  job.chat.learning = first.learning
  job.chat.messages.push(
    { id: randomUUID(), role: "assistant", content: first.reply, createdAt: new Date().toISOString(), topicIds: [] },
    { id: randomUUID(), role: "user", content: "Continue the same conversation", createdAt: new Date().toISOString(), topicIds: [] },
  )
  const second = await runCodexTutorTurn(job, () => {}, () => {})
  expect(second.providerSession.threadId).toBe(first.providerSession.threadId)
  const requests = (await readFile(join(home, "requests.jsonl"), "utf8")).trim().split("\n")
    .map((line) => z.object({ method: z.string().optional(), params: z.json().optional() }).parse(JSON.parse(line)))
  expect(requests.filter((request) => request.method === "thread/start")).toHaveLength(1)
  expect(requests.find((request) => request.method === "thread/start")?.params).toMatchObject({ ephemeral: false })
  expect(requests.find((request) => request.method === "thread/resume")?.params).toMatchObject({ threadId: first.providerSession.threadId, excludeTurns: true })
  expect(requests.filter((request) => request.method === "turn/start").at(-1)?.params).toMatchObject({ input: [{ type: "text", text: "Continue the same conversation" }] })
})

test.each(["pending", "missing", "other-account", "old-tools", "old-tools-v2", "old-handoff-tools", "old-response-tools", "old-web-tools", "old-topic-uuid-tools"])("reconstructs committed history when the saved session is %s", async (reason) => {
  const { job, home } = await fixture(reason === "missing" ? "resume-missing" : "completed")
  if (!job.codex) throw new Error("Missing connection")
  job.chat.providerSession = { provider: "codex", threadId: "thread", home: job.codex.home, executable: job.codex.executable, toolVersion: 14, status: "ready" }
  if (reason === "old-tools") job.chat.providerSession.toolVersion = 1
  if (reason === "old-tools-v2") job.chat.providerSession.toolVersion = 2
  if (reason === "old-handoff-tools") job.chat.providerSession.toolVersion = 10
  if (reason === "old-response-tools") job.chat.providerSession.toolVersion = 11
  if (reason === "old-web-tools") job.chat.providerSession.toolVersion = 12
  if (reason === "old-topic-uuid-tools") job.chat.providerSession.toolVersion = 13
  if (reason === "pending") job.chat.providerSession.status = "pending"
  if (reason === "other-account") job.chat.providerSession.home = "/different/account"
  const first = { id: randomUUID(), role: "user" as const, content: "An early request that must survive", createdAt: new Date().toISOString(), topicIds: [] }
  job.chat.messages.unshift(first, ...Array.from({ length: 35 }, (_, index) => ({ ...first, id: randomUUID(), content: `Earlier message ${index}` })))
  await runCodexTutorTurn(job, () => {}, () => {})
  const requests = await readFile(join(home, "requests.jsonl"), "utf8")
  expect(requests).toContain('"method":"thread/start"')
  expect(requests).toContain(first.content)
  if (reason !== "missing") expect(requests).not.toContain('"method":"thread/resume"')
})

test("does not replace a resumable conversation on a transient provider failure", async () => {
  const { job, home } = await fixture("resume-network")
  if (!job.codex) throw new Error("Missing connection")
  job.chat.providerSession = { provider: "codex", threadId: "thread", home: job.codex.home, executable: job.codex.executable, toolVersion: 14, status: "ready" }
  await expect(runCodexTutorTurn(job, () => {}, () => {})).rejects.toThrow("temporarily unavailable")
  expect(await readFile(join(home, "requests.jsonl"), "utf8")).not.toContain('"method":"thread/start"')
})

test.each([false, true])("Codex streams final answer deltas while keeping commentary and other threads hidden with pending assessment=%s", async (pendingAssessment) => {
  const { job, home } = await fixture()
  if (pendingAssessment) {
    await writeFile(join(home, "state.json"), JSON.stringify({
      ...job.chat.learning,
      phase: "awaiting_answer",
      pendingQuestion: "Evaluate the integral.",
      privateAnswerKey: "The checked integral is minus nine halves.",
      workpad: "Waiting for the learner's answer.",
    }))
  }
  const updates: string[] = []
  const result = await runCodexTutorTurn(job, () => {}, () => {}, undefined, undefined, (text: string) => updates.push(text))
  expect(updates).toContain("Here is your")
  expect(updates.at(-1)).toBe(result.reply)
  expect(updates.join(" ")).not.toContain("Private commentary")
  expect(updates.join(" ")).not.toContain("Wrong thread")
})
