import { randomUUID } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { expect, test } from "vitest"
import { z } from "zod"
import { applyScratchpadMutation } from "../src/main/state-service"
import { newChat } from "../src/main/workspace"
import { ChatSchema, RunnerSchema, WorkerJobSchema, WorkspaceSchema } from "../src/shared/contracts"
import { TopicStateSchema } from "../src/shared/topic-state"
import { parseTopicDirectory } from "../src/shared/topic-directory"
import { runCodexTutorTurn } from "../src/runners/codex"

const environment = z.object({
  EDU_SLIDE_EVAL_WORKSPACE: z.string().optional(),
  EDU_SLIDE_EVAL_CHAT: z.string().uuid().optional(),
  EDU_SLIDE_EVAL_CHECKPOINT: z.string().optional(),
}).parse(process.env)

test.skipIf(!environment.EDU_SLIDE_EVAL_WORKSPACE || !environment.EDU_SLIDE_EVAL_CHAT)("connected tutor follows lecture sections before later worked examples", async () => {
  if (!environment.EDU_SLIDE_EVAL_WORKSPACE || !environment.EDU_SLIDE_EVAL_CHAT) throw new Error("Provide a lecture workspace and chat")
  const directory = await mkdtemp(join(tmpdir(), "edu-slide-eval-"))
  const workspaceDirectory = environment.EDU_SLIDE_EVAL_WORKSPACE
  const database = new DatabaseSync(join(workspaceDirectory, "state.sqlite"), { readOnly: true })
  let sourceChat
  let runners
  try {
    const row = z.object({ payload: z.string() }).parse(database.prepare("SELECT payload FROM chats WHERE id = ?").get(environment.EDU_SLIDE_EVAL_CHAT))
    sourceChat = ChatSchema.parse({ ...JSON.parse(row.payload), messages: [] })
    const settings = z.object({ payload: z.string() }).parse(database.prepare("SELECT payload FROM metadata WHERE key = 'settings'").get())
    runners = z.object({ runners: z.array(RunnerSchema) }).parse(JSON.parse(settings.payload)).runners
  } finally {
    database.close()
  }
  const runner = runners.find((runner) => runner.id === sourceChat.runnerId)
  if (!runner || runner.provider !== "codex") throw new Error("The source chat must use connected Codex")
  let checkpoint
  if (environment.EDU_SLIDE_EVAL_CHECKPOINT) checkpoint = z.object({ chat: ChatSchema, topics: WorkspaceSchema.shape.topics, replies: z.array(z.string()) })
    .parse(JSON.parse(await readFile(environment.EDU_SLIDE_EVAL_CHECKPOINT, "utf8")))
  const workspace = WorkspaceSchema.parse({ version: 2, runners: [runner], chats: [checkpoint?.chat ?? newChat(runner.id)], topics: checkpoint?.topics ?? [] })
  const chat = workspace.chats[0]
  chat.materials = sourceChat.materials
  chat.scratchpadRequested = !checkpoint
  const assetDirectory = join(directory, "assets")
  await mkdir(assetDirectory)
  for (const material of chat.materials)
    await copyFile(join(workspaceDirectory, "chats", sourceChat.id, "assets", material.name), join(assetDirectory, material.name))
  const replies: string[] = checkpoint?.replies ?? []
  async function turn(content: string, confirmTopicId?: string) {
    chat.messages.push({ id: randomUUID(), role: "user", content, topicIds: workspace.topics.map((topic) => topic.id), createdAt: new Date().toISOString() })
    const job = WorkerJobSchema.parse({
      chat, topics: workspace.topics.map((topic) => ({ ...topic, assetDirectory })),
      runner, assetDirectory, openedTopicId: workspace.topics[0]?.id, confirmTopicId,
      skillDirectory: resolve("resources/tutor-me"),
      codex: { executable: resolve("resources/codex/bin/codex"), home: join(workspaceDirectory, "providers", "codex") },
    })
    const result = await runCodexTutorTurn(job, (message) => console.info(message), () => {}, (event, details) => {
      if (event === "tool.result") console.info(event, details)
    })
    for (const mutation of result.topicMutations) applyScratchpadMutation(workspace, chat.id, mutation)
    chat.learning = result.learning
    chat.providerSession = result.providerSession
    chat.messages.push({ id: randomUUID(), role: "assistant", content: result.reply, topicIds: workspace.topics.map((topic) => topic.id), createdAt: new Date().toISOString() })
    replies.push(result.reply)
    await writeFile(join(directory, "result.json"), JSON.stringify({ replies, topics: workspace.topics, learning: chat.learning, chat }, null, 2), { mode: 0o600 })
    console.info("Slide evaluation result:", join(directory, "result.json"))
    return result
  }
  if (!checkpoint) await turn("Help me work with the attached materials. Create a topic.")
  const topic = workspace.topics[0]
  if (!topic) throw new Error("The tutor did not create a topic")
  const state = TopicStateSchema.parse(topic.state)
  const lectureA = chat.materials.find((material) => material.name.startsWith("Lecture 3A"))
  if (!lectureA) throw new Error("This evaluation requires the Lecture 3A number representation deck")
  const ranges = state.content.flatMap((part) => part.references.flatMap((reference) => {
    if (reference.type !== "pdf" || reference.path !== `assets/${lectureA.name}`) return []
    return reference.pages
  }))
  for (const page of [5, 6, 7, 8, 9, 10, 14, 16, 17, 20, 21, 22, 23]) {
    expect.soft(ranges.some((range) => range.from <= page && range.to >= page), `Lecture A slide ${page} must be covered by the plan`).toBe(true)
  }
  expect.soft(state.content.some((part) => part.references.some((reference) => reference.type === "pdf" &&
    reference.path.includes("Lecture 3B") && reference.pages.some((range) => range.from <= 24 && range.to >= 24))),
  "the unnumbered past-year code example on Lecture B slide 24 must be retained").toBe(true)
  if (!checkpoint) {
    topic.planConfirmed = true
    chat.scratchpadRequested = false
    await turn("I confirm this learning plan. Begin at the suggested starting point.", topic.id)
    expect.soft(chat.learning.pendingQuestion).not.toContain("1101.101")
    expect.soft(chat.learning.pendingQuestion).not.toMatch(/positional weights|powers of 2/i)
    expect.soft(replies.at(-1)).toMatch(/01000110|data type|interpret|\bint\b|\bchar\b/i)
    expect.soft(parseTopicDirectory(topic.learning.notes).after).not.toContain("1101.101")
  }
  expect.soft(TopicStateSchema.parse(topic.state).content[0].name).toMatch(/data representation/i)
  const observedSections: number[] = []
  if (checkpoint) {
    const progress = state.threadTutors.find((thread) => thread.id === chat.id)?.progress
    for (const [index, part] of state.content.slice(0, 4).entries()) {
      if (progress?.[part.id]?.status !== "completed") break
      observedSections.push(index)
    }
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = TopicStateSchema.parse(topic.state)
    const progress = current.threadTutors.find((thread) => thread.id === chat.id)?.progress
    const pending = current.content.find((part) => progress?.[part.id]?.steps.some((step) => step.answerFromUser === undefined && step.question === chat.learning.pendingQuestion))
    if (!pending) throw new Error("The source section for the pending question is missing")
    const reference = pending.references.find((reference) => reference.type === "pdf" && reference.path === `assets/${lectureA.name}`)
    if (!reference || reference.type !== "pdf") throw new Error("The pending section has no lecture A pages")
    const page = reference.pages[0].from
    let section = 0
    let answer = "The bits alone have no fixed meaning. The type determines their interpretation: 01000110 is 70 as int and F as char. The lecture's longer pattern 11000000110100000000000000000000 means -1060110336 as int and -6.5 as float. A bit is 0 or 1, a byte has 8 bits, a nibble has 4 bits, and a word is an architecture-dependent multiple of bytes. N independent binary positions give 2*2*...*2 = 2^N patterns; each additional bit doubles the number of patterns. For M distinct values we need the smallest integer N with 2^N >= M, namely ceil(log2 M). Two bits encode 4 values, four bits encode 16, five bits encode 32, six bits encode 64, and eight bits encode 256. For 32 values we need 5 bits. For 1000 values we need 10 bits: 2^9=512 and 2^10=1024, so nine bits are insufficient because 512<1000, while ten bits suffice because 1024>=1000. The extra 24 patterns can remain unused. For 70 distinct values we need 7 bits because 2^6=64 < 70 <= 128=2^7."
    for (const match of chat.learning.pendingQuestion.matchAll(/(\d[\d,]*)\s+(?:(?:distinct|different|possible)\s+)?(?:values|patterns|states|symbols)/gi)) {
      const count = Number(match[1].replaceAll(",", ""))
      const bits = Math.max(0, Math.ceil(Math.log2(count)))
      answer += ` ${count} distinct values require ${bits} bits: ${2 ** (bits - 1)} < ${count} <= ${2 ** bits}. One fewer bit has insufficient capacity.`
    }
    if (page === 7) {
      section = 1
      answer = "Decimal has base 10 and digits 0 through 9. Position gives each digit a power-of-ten weight. For 7594.36, the expansion is 7*10^3 + 5*10^2 + 9*10^1 + 4*10^0 + 3*10^-1 + 6*10^-2 = 7000 + 500 + 90 + 4 + 0.3 + 0.06 = 7594.36. The whole-number terms add to 7594, and the fractional terms add to 0.36 because 3/10 + 6/100 = 30/100 + 6/100 = 36/100. Positions left of the point start at exponent 0 and increase leftward; right of it they start at -1 and decrease. Moving left multiplies the place weight by 10, and moving right divides it by 10."
      // Follow-up checks can choose other numerals; answer the actual question rather than repeating the slide's example.
      for (const numeral of new Set(chat.learning.pendingQuestion.match(/\b\d+\.\d+\b/g) ?? [])) {
        const wholeLength = numeral.split(".")[0].length
        const digits = [...numeral.replace(".", "")]
        const expansion = digits.map((digit, index) => `${digit} * 10^${wholeLength - index - 1}`).join(" + ")
        const products = digits.map((digit, index) => Number(digit) * 10 ** (wholeLength - index - 1)).join(" + ")
        answer += ` ${numeral} = ${expansion} = ${products} = ${numeral}. Zero-valued digits retain their positions and contribute zero to the sum.`
      }
    } else if (page >= 8 && page <= 9) {
      section = 2
      answer = "Binary has base 2 and digits 0,1; octal has base 8 and digits 0–7; hexadecimal has base 16 with digits 0–9 and A–F for 10–15. Their position weights are powers of the base. C uses prefix 0 for octal and 0x for hexadecimal: 032 is octal 32, or 3*8+2=26 in decimal, while 0x32 is hexadecimal 32, or 3*16+2=50 in decimal. QTSpim uses 0x too. Verilog 8'b11110000, 8'hF0 and 8'd240 denote the same eight-bit pattern with decimal value 240. The 8 is the bit width, and b/h/d selects the written base; changing the notation does not change the bits or value."
    } else if (page >= 10) {
      section = 3
    }
    if (observedSections.at(-1) !== section) observedSections.push(section)
    if (section === 3) break
    expect.soft(chat.learning.pendingQuestion).not.toContain("1101.101")
    expect.soft(parseTopicDirectory(topic.learning.notes).after).not.toContain("1101.101")
    await turn(answer)
  }
  expect(observedSections, "the tutor must walk through data representation, decimal, other bases, then conversion").toEqual([0, 1, 2, 3])
}, 300_000)
