import { randomUUID } from "node:crypto"
import {
  access,
  mkdtemp,
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
import { runCodexTutorTurn } from "../src/runners/codex"
import { generateTopicTitle } from "../src/runners/title"
import { createTutorSession } from "../src/runners/tutor"
import { newChat } from "../src/main/workspace"
import { WorkerJobSchema, WorkspaceSchema } from "../src/shared/contracts"

const directories: string[] = []
const clients: CodexAppServer[] = []
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
      ephemeral: true,
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
}, 45_000)

test("Codex uses Tutor Me tool validation and returns a saved plan only after turn completion", async () => {
  const { job, home } = await fixture()
  const processes: (number | null)[] = []
  const result = await runCodexTutorTurn(
    job,
    () => {},
    (pid) => processes.push(pid),
  )
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
    "save_topic_state",
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

test("existing runners retain OpenRouter when provider metadata is introduced", () => {
  const id = randomUUID()
  const workspace = WorkspaceSchema.parse({
    version: 2,
    runners: [{ id, name: "Existing tutor", model: "openrouter/auto" }],
    topics: [],
    chats: [],
  })
  expect(workspace.runners[0].provider).toBe("openrouter")
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
  const title = await generateTopicTitle(job, undefined, (pid) => processes.push(pid), () => {})
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
  await expect(generateTopicTitle(job, undefined, (pid) => processes.push(pid), () => {})).rejects.toThrow()
  expect(processes.at(-1)).toBeNull()
})

test("does not use an expensive tutor model when no budget Codex model is available", async () => {
  const { job, home } = await fixture()
  await expect(generateTopicTitle(job, undefined, () => {}, () => {})).rejects.toThrow("No budget title model")
  expect(await readFile(join(home, "requests.jsonl"), "utf8")).not.toContain('"method":"thread/start"')
})
