import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { test } from "node:test"
import { newChat, newScratchpad } from "../main/workspace"
import { WorkerJobSchema } from "../shared/contracts"
import { TopicStateSchema } from "../shared/topic-state"
import { createTutorSession } from "./tutor"
import { applyTopicMutation } from "../main/state-service"
import { createWorkflowRoleSession } from "./workflow-session"
import { RoleJobSchema } from "../shared/tutor-workflow"

const check = {
  goalIndex: 0, criterionIndex: 0,
  reasoningTask: "Infer the scope of a limit from its parent heading",
  missingEvidence: "Whether the learner connects the heading to the scope of the list item",
  expectedEvidence: "The heading makes the limit apply to each batch rather than all batches combined",
}

function feedbackJob() {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const scratchpad = newScratchpad("Large PDF parsing")
  scratchpad.planConfirmed = true
  scratchpad.state = TopicStateSchema.parse({ ...scratchpad.state, content: [{
    id: "tp-structure", name: "Structure-aware chunks", references: [], mistakes: [],
    goals: [{ objective: "Connect structure-aware chunks and provenance to reliable retrieval", understoodWhen: ["Explains how preserving headings retains a list item's scope", "Uses page and chunk provenance to locate evidence"] }],
  }] })
  chat.scratchpadHandles = [scratchpad.id]
  chat.messages.push({ id: randomUUID(), role: "user", content: "Continue the PDF parsing lesson", createdAt: chat.createdAt, scratchpadIds: [scratchpad.id] })
  return WorkerJobSchema.parse({ runner, chat, scratchpads: [{ ...scratchpad, assetDirectory: "/tmp" }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
}

test("changed numbers cannot restart a repeated cap check, and the tutor can explain and continue", async () => {
  const job = feedbackJob()
  const session = await createTutorSession(job, () => {})
  const target = { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure" }
  const question = "Under a cap of 20 files per batch, do three batches of 18 files comply?"
  assert.equal((await session.execute("topic_recordQuestion", { ...target, question, check })).success, true)
  const answer = "They are separate batches, so they wont be affected by the operation"
  assert.equal((await session.execute("topic_recordAnswer", { ...target, stepIndex: 0, answerFromUser: answer, assessment: {
    goalIndex: 0, criterionIndex: 0, status: "uncertain", evidence: [{ stepIndex: 0, quote: answer }],
    interpretation: "The learner identifies separate batches; the wording about the cap is uncertain",
    remainingGap: "Whether they connect per-batch scope to the preserved heading",
  } })).success, true)
  const duplicate = await session.execute("topic_recordQuestion", { ...target, question: "Under a cap of 17 files per batch, do three batches of 16 files comply?", check })
  assert.equal(duplicate.success, false, "Changing numbers must not create a new reasoning task")
  assert.match(duplicate.text, /repeat|same reasoning/i)
  const saved = await session.execute("save_learning_state", { ...job.chat.learning, phase: "ready_to_continue", nextAction: "Explain heading scope and continue to provenance", workpad: "Heading grouping is supported. Applying the cap remains uncertain; defer it instead of repeating the check." })
  assert.equal(saved.success, true, saved.text)
  assert.equal(session.saved, true, session.saveError ?? "The feedback must remain publishable")
  const result = session.finish("The heading gives the list its scope. We can keep that context with the chunk and continue to provenance.")
  assert.doesNotMatch(result.reply, /\[!CHECK\]/)
  assert.equal(result.scratchpadMutations.filter((mutation) => mutation.type === "recordQuestion").length, 1)
})

test("a demonstrated criterion is credited without requiring arithmetic or exact wording", async () => {
  const job = feedbackJob()
  const session = await createTutorSession(job, () => {})
  const target = { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure" }
  await session.execute("topic_recordQuestion", { ...target, question: "What scope does keeping the batch heading preserve?", check })
  const answer = "It will be grouped under During each upload batch"
  const recorded = await session.execute("topic_recordAnswer", { ...target, stepIndex: 0, answerFromUser: answer, assessment: {
    goalIndex: 0, criterionIndex: 0, status: "demonstrated", evidence: [{ stepIndex: 0, quote: answer }],
    interpretation: "The learner connects the list to the heading that supplies its scope", remainingGap: "",
  } })
  assert.equal(recorded.success, true, recorded.text)
  const repeat = await session.execute("topic_recordQuestion", { ...target, question: "Is 16 below the cap of 17?", check: { ...check, reasoningTask: "Compare a batch size to its cap" } })
  assert.equal(repeat.success, false)
  assert.match(repeat.text, /demonstrated/i)
  const next = await session.execute("topic_recordQuestion", { ...target, question: "Two passages share page 88. How would you retrieve exactly one?", check: {
    ...check, criterionIndex: 1, reasoningTask: "Select a locator for an exact passage", missingEvidence: "How chunk IDs distinguish passages on the same page", expectedEvidence: "Use the chunk ID with the document locator",
  } })
  assert.equal(next.success, true, next.text)
  const saved = await session.execute("save_learning_state", { ...job.chat.learning, phase: "awaiting_answer", pendingCheck: { ...target, stepIndex: 1 }, privateAnswerKey: "Use the chunk ID", nextAction: "Wait for the provenance answer", workpad: "Heading scope is demonstrated. Provenance is pending." })
  assert.equal(saved.success, true, saved.text)
  const result = session.finish("Heading scope is supported. Next, consider provenance.")
  for (const mutation of result.scratchpadMutations) {
    if (mutation.type === "recordQuestion" || mutation.type === "recordAnswer") applyTopicMutation({ chats: [job.chat], scratchpads: job.scratchpads }, job.chat.id, mutation)
  }
  job.chat.learning = result.learning
  const resumed = await createTutorSession(WorkerJobSchema.parse(JSON.parse(JSON.stringify(job))), () => {})
  assert.match(resumed.instructions, /The learner connects the list to the heading that supplies its scope/)
  assert.equal((await resumed.execute("topic_recordQuestion", { ...target, question: "What is the scope of a cap under this heading?", check: { ...check, reasoningTask: "Restate the scope using an upload example" } })).success, false)
})

test("assessment interpretations cannot fabricate learner evidence", async () => {
  const session = await createTutorSession(feedbackJob(), () => {})
  const target = { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure" }
  await session.execute("topic_recordQuestion", { ...target, question: "What does the heading tell you?", check })
  const recorded = await session.execute("topic_recordAnswer", { ...target, stepIndex: 0, answerFromUser: "The batches are separate", assessment: {
    goalIndex: 0, criterionIndex: 0, status: "contradicted", evidence: [{ stepIndex: 0, quote: "The combined 54 files violate the cap" }],
    interpretation: "The learner compares the total with the cap", remainingGap: "Per-batch scope",
  } })
  assert.equal(recorded.success, false)
  assert.match(recorded.text, /verbatim|actual answer/i)
})

test("a contradiction permits one different application, then uncertainty is deferred", async () => {
  const job = feedbackJob()
  const session = await createTutorSession(job, () => {})
  const target = { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure" }
  await session.execute("topic_recordQuestion", { ...target, question: "Would losing a batch heading change how an agent interprets the list?", check })
  const answer = "No, the heading adds no meaning"
  const recorded = await session.execute("topic_recordAnswer", { ...target, stepIndex: 0, answerFromUser: answer, assessment: {
    goalIndex: 0, criterionIndex: 0, status: "contradicted", evidence: [{ stepIndex: 0, quote: answer }],
    interpretation: "The answer explicitly denies the role of the heading", remainingGap: "How the heading supplies scope",
  } })
  assert.equal(recorded.success, true, recorded.text)
  const followup = await session.execute("topic_recordQuestion", { ...target, question: "An agent retrieved a limit under the wrong heading. Which retrieval context would you repair?", check: {
    ...check, reasoningTask: "Repair a retrieval that attaches a list to the wrong parent heading", expectedEvidence: "Retrieve the actual parent heading with the list",
  } })
  assert.equal(followup.success, true, followup.text)
  const secondAnswer = "idk"
  await session.execute("topic_recordAnswer", { ...target, stepIndex: 1, answerFromUser: secondAnswer, assessment: {
    goalIndex: 0, criterionIndex: 0, status: "uncertain", evidence: [{ stepIndex: 1, quote: secondAnswer }],
    interpretation: "The learner has not supplied an independent repair", remainingGap: "Selecting the parent context to retain",
  } })
  const third = await session.execute("topic_recordQuestion", { ...target, question: "Predict the answer if a different heading is attached to the list", check: {
    ...check, reasoningTask: "Predict a retrieval failure caused by a mismatched heading",
  } })
  assert.equal(third.success, false)
  assert.match(third.text, /already had a check and a follow-up/)
  await session.execute("save_learning_state", { ...job.chat.learning, phase: "ready_to_continue", nextAction: "Explain parent context directly and continue to provenance", workpad: "The heading repair remains uncertain. Preserve it for later review." })
  assert.equal(session.saved, true)
})

test("checks cannot promote example details into a new curriculum criterion", async () => {
  const session = await createTutorSession(feedbackJob(), () => {})
  const target = { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure" }
  const missing = await session.execute("topic_recordQuestion", { ...target, question: "Is 16 below 17?" })
  assert.equal(missing.success, false)
  assert.match(missing.text, /existing goalIndex/)
  const invented = await session.execute("topic_recordQuestion", { ...target, question: "Is 16 below 17?", check: { ...check, criterionIndex: 2 } })
  assert.equal(invented.success, false)
  assert.match(invented.text, /example does not create a new learning criterion/)
})

test("a repetition complaint ends checks for this reply without blocking publication", async () => {
  const job = feedbackJob()
  job.chat.messages.at(-1)!.content = "I ALREADY SAID IT WONT BE AFFECTED WHY ARE YOU ASKING ME THE SAME QNS OVER AND OVER"
  const session = await createTutorSession(job, () => {})
  const recorded = await session.execute("topic_recordQuestion", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure", question: "Would 18 exceed a cap of 17?", check })
  assert.equal(recorded.success, false)
  assert.match(recorded.text, /learner objected/i)
  const standalone = await session.execute("save_learning_state", { ...job.chat.learning, phase: "awaiting_answer", question: "Would 18 exceed 17?", privateAnswerKey: "Yes", nextAction: "Wait for an answer", workpad: "Ask the comparison again" })
  assert.equal(standalone.success, false)
  const clarification = await session.execute("save_learning_state", { ...job.chat.learning, phase: "awaiting_clarification", question: "What do you mean by unaffected?", nextAction: "Wait for clarification", workpad: "Clarify the same comparison" })
  assert.equal(clarification.success, false)
  const saved = await session.execute("save_learning_state", { ...job.chat.learning, phase: "ready_to_continue", nextAction: "Acknowledge repetition and explain directly", workpad: "Stop the repeated comparison; retain uncertainty for later." })
  assert.equal(saved.success, true, saved.text)
  assert.equal(session.saved, true, session.saveError ?? "The complaint must not cause a repair loop")
  assert.doesNotMatch(session.finish("I kept repeating the comparison. The heading determines the scope of the list item.").reply, /\[!CHECK\]/)
})

test("legacy steps remain readable and can acquire an assessment without rewriting history", async () => {
  const job = feedbackJob()
  const scratchpad = job.scratchpads[0]
  const question = "What does the heading preserve?"
  scratchpad.state = TopicStateSchema.parse({ ...scratchpad.state, threadTutors: [{ id: job.chat.id, progress: { "tp-structure": { status: "active", steps: [{ question }] } } }] })
  const session = await createTutorSession(job, () => {})
  const answer = "The list belongs under During each upload batch"
  const recorded = await session.execute("topic_recordAnswer", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure", stepIndex: 0, answerFromUser: answer, assessment: {
    goalIndex: 0, criterionIndex: 0, status: "demonstrated", evidence: [{ stepIndex: 0, quote: answer }],
    interpretation: "The learner identifies the heading that supplies the list's scope", remainingGap: "",
  } })
  assert.equal(recorded.success, true, recorded.text)
  const duplicate = await session.execute("topic_recordQuestion", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure", question: "Which parent context applies?", check })
  assert.equal(duplicate.success, false)
  assert.match(duplicate.text, /demonstrated/)
})

test("practice on a completed part can revise earlier evidence and receive one follow-up", async () => {
  const job = feedbackJob()
  const scratchpad = job.scratchpads[0]
  const answer = "The heading tells us the scope"
  scratchpad.state = TopicStateSchema.parse({ ...scratchpad.state, threadTutors: [{ id: job.chat.id, progress: { "tp-structure": { status: "completed", steps: [{
    question: "What does this heading supply?", check, answerFromUser: answer,
    assessment: { goalIndex: 0, criterionIndex: 0, status: "demonstrated", evidence: [{ stepIndex: 0, quote: answer }], interpretation: "Heading scope is supported", remainingGap: "" },
  }] } } }] })
  job.chat.messages.at(-1)!.content = "Quick practice"
  const session = await createTutorSession(job, () => {})
  const target = { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure" }
  const practice = await session.execute("topic_recordQuestion", { ...target, question: "A chunk was paired with another section's heading. Diagnose the effect.", check: {
    ...check, reasoningTask: "Diagnose a chunk paired with the wrong heading",
  } })
  assert.equal(practice.success, true, practice.text)
  const wrong = "Swapping headings cannot change the interpretation"
  const recorded = await session.execute("topic_recordAnswer", { ...target, stepIndex: 1, answerFromUser: wrong, assessment: {
    goalIndex: 0, criterionIndex: 0, status: "contradicted", evidence: [{ stepIndex: 1, quote: wrong }],
    interpretation: "This answer contradicts the role of heading context", remainingGap: "How different headings change the list's scope",
  } })
  assert.equal(recorded.success, true, recorded.text)
  const followup = await session.execute("topic_recordQuestion", { ...target, question: "Which parent context would you restore to repair the retrieved list?", check: {
    ...check, reasoningTask: "Select a context repair for the mismatched chunk",
  } })
  assert.equal(followup.success, true, followup.text)
})

test("previously staged workflow operations without structured checks still replay", async () => {
  const job = feedbackJob()
  const session = await createTutorSession(job, () => {}, undefined, { operations: [
    { type: "recordQuestion", scratchpadId: job.scratchpads[0].id, scratchpadPartId: "tp-structure", question: "Does a batch of 16 meet a cap of 17?" },
    { type: "recordAnswer", scratchpadId: job.scratchpads[0].id, scratchpadPartId: "tp-structure", stepIndex: 0, answerFromUser: "It wont be affected" },
    { type: "recordQuestion", scratchpadId: job.scratchpads[0].id, scratchpadPartId: "tp-structure", question: "Does a batch of 18 meet a cap of 20?" },
  ] })
  const evidence = await session.execute("topic_getQuestions", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure" })
  assert.equal(evidence.success, true, evidence.text)
  assert.match(evidence.text, /It wont be affected/)
  assert.match(evidence.text, /batch of 18/)
})

test("the page-range answer can be reassessed from cumulative evidence and published without another question", async () => {
  const job = feedbackJob()
  const scratchpad = job.scratchpads[0]
  const earlierAnswer = "You only have limited context, it can be slow and costly to take in the whole report in 1 shot. It cannot be parallelized"
  const answer = "bounded ranges helps with targetting. No it does not"
  const rangeCheck = { ...check, reasoningTask: "Distinguish bounded input from parallel execution", missingEvidence: "How a range bounds one job's work", expectedEvidence: "A range focuses the job without preventing concurrent jobs" }
  scratchpad.state = TopicStateSchema.parse({ ...scratchpad.state,
    content: [{ id: "tp-structure", name: "Page ranges", references: [], mistakes: [], goals: [{ objective: "Explain how bounded ranges scale processing", understoodWhen: ["Explains how a range bounds work for large PDFs"] }] }],
    threadTutors: [{ id: job.chat.id, progress: { "tp-structure": { status: "active", steps: [
      { question: "Why select pages 80–95 rather than the whole report?", answerFromUser: earlierAnswer },
      { question: "What does a bounded range gain, and does it prevent concurrent jobs?", check: rangeCheck },
    ] } } }],
  })
  const target = { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure", stepIndex: 1, answerFromUser: answer }
  const session = await createTutorSession(job, () => {})
  const uncertain = {
    goalIndex: 0, criterionIndex: 0, status: "uncertain",
    evidence: [{ stepIndex: 1, quote: answer }], interpretation: "Targeting and concurrency are recognized, but the per-job benefit is not explicit", remainingGap: "Per-job input bounds",
  }
  const first = await session.execute("topic_recordAnswer", { ...target, assessment: uncertain })
  assert.equal(first.success, true, first.text)
  const revised = {
    ...uncertain, status: "demonstrated", evidence: [{ stepIndex: 0, quote: earlierAnswer }, { stepIndex: 1, quote: answer }],
    interpretation: "The earlier answer explains context, time and cost; the current answer supplies targeting and corrects the parallelism claim", remainingGap: "",
  }
  const second = await session.execute("topic_recordAnswer", { ...target, assessment: revised })
  assert.equal(second.success, true, second.text)
  const retry = await session.execute("topic_recordAnswer", { ...target, assessment: revised })
  assert.equal(retry.success, true, retry.text)
  const completed = await session.execute("topic_complete", { scratchpadId: target.scratchpadId, scratchpadPartId: target.scratchpadPartId })
  assert.equal(completed.success, true, completed.text)
  const saved = await session.execute("save_learning_state", { ...job.chat.learning, phase: "ready_to_continue", nextAction: "Acknowledge the answer and continue without another check", workpad: "Cumulative evidence demonstrates the page-range criterion." })
  assert.equal(saved.success, true, saved.text)
  assert.equal(session.saved, true, session.saveError ?? "Reassessment must not poison publication")
  const result = session.finish("Your earlier answer supplies the context, time and cost rationale. Your latest answer correctly distinguishes targeting from concurrency.")
  assert.equal(result.scratchpadMutations.some((mutation) => mutation.type === "recordQuestion"), false)
  assert.doesNotMatch(result.reply, /\[!CHECK\]/)
  for (const mutation of result.scratchpadMutations) {
    if (mutation.type === "recordAnswer" || mutation.type === "complete") applyTopicMutation({ chats: [job.chat], scratchpads: job.scratchpads }, job.chat.id, mutation)
  }
  const state = TopicStateSchema.parse(scratchpad.state)
  const progress = state.threadTutors[0].progress["tp-structure"]
  assert.equal(progress.status, "completed")
  assert.equal(progress.steps.length, 2)
  assert.equal(progress.steps[1].answerFromUser, answer)
  assert.deepEqual(progress.steps[1].assessment, revised)
  assert.deepEqual(progress.steps[1].assessmentHistory, [uncertain], "Identical retries must not duplicate assessment history")
})

test("reassessment preserves the learner's recorded answer while allowing recovery from an attempted rewrite", async () => {
  const job = feedbackJob()
  const answer = "The list belongs under the batch heading"
  job.scratchpads[0].state = TopicStateSchema.parse({ ...job.scratchpads[0].state, threadTutors: [{ id: job.chat.id, progress: { "tp-structure": { status: "active", steps: [
    { question: "What context belongs with this list?", check, answerFromUser: answer },
  ] } } }] })
  const session = await createTutorSession(job, () => {})
  const target = { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure", stepIndex: 0 }
  const rewritten = await session.execute("topic_recordAnswer", { ...target, answerFromUser: "The cap applies per batch because 16 is less than 17" })
  assert.equal(rewritten.success, false)
  assert.match(rewritten.text, /preserve|unchanged/i)
  const corrected = await session.execute("topic_recordAnswer", { ...target, answerFromUser: answer, assessment: {
    goalIndex: 0, criterionIndex: 0, status: "demonstrated", evidence: [{ stepIndex: 0, quote: answer }],
    interpretation: "The original answer identifies the parent heading", remainingGap: "",
  } })
  assert.equal(corrected.success, true, corrected.text)
  await session.execute("save_learning_state", { ...job.chat.learning, phase: "ready_to_continue", nextAction: "Credit heading context", workpad: "Original evidence is preserved and assessed." })
  assert.equal(session.saved, true, session.saveError ?? "A valid reassessment clears the rejected rewrite")
})

test("a table-context clarification cannot silently revive an older page-range check", async () => {
  const job = feedbackJob()
  job.scratchpads[0].state = TopicStateSchema.parse({ ...job.scratchpads[0].state, threadTutors: [{ id: job.chat.id, progress: { "tp-structure": { status: "active", steps: [
    { question: "Which pages does a bounded page-range job process?" },
    { question: "What context belongs with the table row?", check, answerFromUser: "what" },
  ] } } }] })
  const session = await createTutorSession(job, () => {})
  const saved = await session.execute("save_learning_state", { ...job.chat.learning, phase: "awaiting_answer", privateAnswerKey: "The heading", nextAction: "Wait for the heading answer", workpad: "The current setup concerns heading context, not page ranges." })
  assert.equal(saved.success, false, "An old unanswered check must not become the current check by fallback")
})

test("clarifying a check displays the clarified prompt while retaining its original evidence target", async () => {
  const job = feedbackJob()
  const original = "If a table row loses its heading, what could go wrong and what should a chunk keep together?"
  const clarified = "Which label in this example identifies the equipment for the row?"
  job.scratchpads[0].state = TopicStateSchema.parse({ ...job.scratchpads[0].state, threadTutors: [{ id: job.chat.id, progress: { "tp-structure": { status: "active", steps: [{ question: original, check }] } } }] })
  const session = await createTutorSession(job, () => {})
  const saved = await session.execute("save_learning_state", { ...job.chat.learning, phase: "awaiting_clarification", question: clarified,
    pendingCheck: { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure", stepIndex: 0 }, privateAnswerKey: "The equipment heading",
    nextAction: "Assess the answer to this clarification against the same heading-context criterion", workpad: "The learner asked what the example means; no assessment answer has been recorded.",
  })
  assert.equal(saved.success, true, saved.text)
  const result = session.finish("Invented example:\n\n| Equipment heading | Table row |\n|---|---|\n| Forklift A | Maximum load: 500 kg |")
  assert.equal(result.reply.includes(clarified), true)
  assert.equal(result.reply.includes(original), false)
  assert.match(result.reply, /\[!CHECK\]/, "A clarification tied to a topic check must retain the check presentation")
  assert.equal(result.learning.pendingCheck?.stepIndex, 0)
  assert.equal(result.scratchpadMutations.length, 0)
})

test("a genuine answer after clarification is retained alongside the earlier response", async () => {
  const job = feedbackJob()
  const answer = "The heading"
  job.chat.messages.at(-1)!.content = answer
  const sourceMessageId = job.chat.messages.at(-1)!.id
  job.chat.messages.push({ id: randomUUID(), role: "user", content: "Continue from my answer", createdAt: job.chat.createdAt, scratchpadIds: [job.scratchpads[0].id] })
  job.scratchpads[0].state = TopicStateSchema.parse({ ...job.scratchpads[0].state, threadTutors: [{ id: job.chat.id, progress: { "tp-structure": { status: "active", steps: [
    { question: "What context belongs with the table row?", check, answerFromUser: "what" },
  ] } } }] })
  const session = await createTutorSession(job, () => {})
  const answerInput = { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure", stepIndex: 0, answerFromUser: answer, assessment: {
    goalIndex: 0, criterionIndex: 0, status: "demonstrated", evidence: [{ stepIndex: 0, quote: answer }],
    interpretation: "The answer to the clarified prompt identifies the parent heading", remainingGap: "",
  } }
  const recorded = await session.execute("topic_recordAnswer", answerInput)
  assert.equal(recorded.success, true, recorded.text)
  assert.equal((await session.execute("topic_recordAnswer", answerInput)).success, true)
  await session.execute("save_learning_state", { ...job.chat.learning, phase: "ready_to_continue", nextAction: "Continue from heading scope to provenance", workpad: "The learner identified the heading after the example was clarified." })
  const result = session.finish("Yes, keep the heading with the row. Next, we can use the page span and chunk ID to trace the passage.")
  job.chat.messages.push({ id: randomUUID(), role: "user", content: "Next please", createdAt: job.chat.createdAt, scratchpadIds: [job.scratchpads[0].id] })
  for (const mutation of result.scratchpadMutations) {
    if (mutation.type === "recordAnswer") applyTopicMutation({ chats: [job.chat], scratchpads: job.scratchpads }, job.chat.id, mutation)
  }
  const step = TopicStateSchema.parse(job.scratchpads[0].state).threadTutors[0].progress["tp-structure"].steps[0]
  assert.equal(step.answerFromUser, "what", "The earlier response remains unchanged")
  assert.deepEqual(step.additionalAnswers, [{ messageId: sourceMessageId, answerFromUser: answer }])
  assert.equal(step.assessment?.status, "demonstrated")
})

test("role recovery retains the original learner request and keeps tool repairs internal", async () => {
  const job = feedbackJob()
  job.chat.messages.at(-1)!.content = "The heading"
  const target = job.scratchpads[0]
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: target.id, scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "existing", snapshot: target, baseVersion: "v1", operations: [],
    request: { target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Continue the lesson from the learner's answer", requestedAccess: "write", replyToLearner: true,
      context: { learnerMessageIds: job.chat.messages.map((message) => message.id), materialIds: [], readDependencies: [], relevantContext: "The learner answered the clarified heading question" } },
  })
  const { session } = await createWorkflowRoleSession(job, role, async () => {}, () => {})
  await session.execute("topic_recordAnswer", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-structure", stepIndex: 16, answerFromUser: "The heading" })
  const recovery = session.recoveryMessage()
  assert.match(recovery, /Original learner request: "The heading"/)
  assert.match(recovery, /not a learner message/)
  assert.match(recovery, /Keep internal tool errors, write operations, and retries out of the lesson/)
})
