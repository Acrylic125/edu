import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test } from "vitest"
import { z } from "zod"
import { newChat } from "../src/main/workspace"
import { MessageSchema, WorkerJobSchema } from "../src/shared/contracts"
import { runCodexTutorTurn } from "../src/runners/codex"
import { TutorPublicationError } from "../src/runners/publication-error"

const environment = z.object({
  EDU_ASSESSMENT_EVAL_HOME: z.string().optional(),
  EDU_ASSESSMENT_EVAL_MODEL: z.string().default("gpt-6-luna"),
}).parse(process.env)

const committeeQuestion = "A club has 18 members. Four form a committee with shared duties. How many committees are possible? Explain why order does or does not matter and show how you compute the count."

test.skipIf(!environment.EDU_ASSESSMENT_EVAL_HOME).each([
  { scenario: "credits reasoning across prior answers", invalidReasoning: false },
  { scenario: "probes a correct result with an invalid justification", invalidReasoning: true },
])("connected assessment $scenario", async ({ invalidReasoning }) => {
  if (!environment.EDU_ASSESSMENT_EVAL_HOME) throw new Error("Provide a connected Codex home")
  const directory = await mkdtemp(join(tmpdir(), "edu-assessment-eval-"))
  try {
    const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: environment.EDU_ASSESSMENT_EVAL_MODEL }
    const chat = newChat(runner.id)
    const conversation = [
      { role: "assistant", content: committeeQuestion },
      { role: "user", content: "18 Choose 4, order does not matter" },
      { role: "assistant", content: "Correct. Now compute C(18,4)=18!/(4!14!) as an integer. Show how you cancel or simplify the factorials and evaluate the result." },
      { role: "user", content: "C(18,4)=18!/(4!14!) = 18 * 17 ... * 1 but we omit 4! and 14!" },
      { role: "assistant", content: "Keep 4! in the denominator. Since 18! = 18·17·16·15·14!, cancel only 14!. What expression remains?" },
      { role: "user", content: "18*17...*1 remove the 14" },
      { role: "assistant", content: "Canceling 14! removes 14·13·…·1. The numerator left is 18·17·16·15, and 4! remains below. Write the full fraction." },
      { role: "user", content: "(18*17*16*15) / 4!" },
      { role: "assistant", content: "Yes. Now evaluate it as an integer. Include the value of 4! and enough arithmetic to show how you got the result." },
      { role: "user", content: "3060" },
    ]
    if (invalidReasoning) {
      conversation.splice(1, conversation.length - 1, {
        role: "user",
        content: "3060. Order matters because each committee member has a different role, so I use permutations.",
      })
    }
    chat.messages = conversation.map((message) => MessageSchema.parse({
      ...message, id: randomUUID(), createdAt: new Date().toISOString(), topicIds: [],
    }))
    chat.learning = { ...chat.learning, phase: "awaiting_answer", currentSection: "Combinations",
      pendingQuestion: conversation.at(-2)?.content ?? committeeQuestion,
      privateAnswerKey: "C(18,4)=18!/(4!14!)=3060. Shared duties mean order does not matter. The 4! removes orderings of the same committee.",
      workpad: "Assess the learner's response to the committee question.",
      nextAction: "Assess the answer and resolve any substantive gap.",
    }
    const job = WorkerJobSchema.parse({
      runner, chat, topics: [], assetDirectory: join(directory, "assets"),
      skillDirectory: resolve("resources/tutor-me"),
      codex: { executable: resolve("resources/codex/bin/codex"), home: environment.EDU_ASSESSMENT_EVAL_HOME },
    })
    const result = await runCodexTutorTurn(job, () => {}, () => {})
    console.info(JSON.stringify({ scenario: invalidReasoning, reply: result.reply, question: result.learning.pendingQuestion }))
    if (invalidReasoning) {
      expect(result.learning.pendingQuestion).toMatch(/order|overcount|arrang|permut|4\s*!/i)
    } else {
      expect(result.reply).toMatch(/3060|3[,{]060|correct|right/i)
      expect(result.learning.pendingQuestion).not.toMatch(/show.*(?:arithmetic|working)|(?:compute|calculate|evaluate|expand).*(?:4\s*!|18\s*[·*×]\s*17)|(?:value|product).*(?:4\s*!|numerator)|what is\s*4\s*!/i)
    }
  } catch (error) {
    if (error instanceof TutorPublicationError) throw new Error(error.detail, { cause: error })
    throw error
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 180_000)
