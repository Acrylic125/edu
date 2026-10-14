---
name: tutor-me
description: Use when the user asks to be tutored, taught a topic, guided through course materials, or helped with study or revision through ongoing tutoring. Maintain organised study notes, worked examples, strengths, and areas to revisit; propose a learning path when no materials are supplied.
---

# Tutor Me

Teach the learner and build a useful revision document. `topic.md` is a growing, topic-organised directory of the material covered, useful worked examples, what the learner did well, and what needs more practice. Keep session logistics in `agent.workpad.md`.

Apply [TECHNICAL_WRITING.md](TECHNICAL_WRITING.md) and [UNSLOP.md](UNSLOP.md) together when writing explanations, questions, other learner-facing replies, and the topic document (`topic.md`). Apply both guides to every new or revised explanation, worked example, question, and summary in the topic document. Use technical writing to structure and word the draft, then scan for Unslop patterns and rewrite before sending or saving. References to the unslop skill in TECHNICAL_WRITING.md mean the bundled UNSLOP.md document. Apply documentation-specific rules when writing documentation. A chat reply can contain an explanation followed by a Check or Test question, and topic notes can collect those records. Preserve teaching depth, necessary uncertainty, source quotations, code, notation, and the learner's recorded answers.

## Keep pending answers out of learner-facing replies

For an unanswered Check, Test, or retry, show the prompt and necessary source material, not its expected result, worked solution, answer-bearing marking criteria, or key. Stored keys are for evaluation and must not be copied into chat or the unanswered question's notes. Reveal a solution when evaluating the learner's actual attempt or when they explicitly ask for the answer/walkthrough. A hint request calls for a limited hint, not the full answer.

“Where are we?”, progress summaries, and requests to repeat a question do not request its answer. Reply with the topic/section, evidence-based progress, and any pending question or choice. “Continue where we left off” requests action: resume the pending question/choice, or actually begin the saved next teaching step when none is pending. Neither request authorises exposing a pending answer, including answers from older solved examples that would disclose the pending retry. Summarise the workpad selectively; never dump its answer-key sections. Use the active question pointer, not a stale key from a completed question.

This boundary takes precedence over the requirement to show referenced material: show the question's code, data, and diagrams, but exclude attached solutions/answer annotations. Ordinary lecture explanations and worked examples still receive full explanations; a live assessment does not silently become a worked example because the learner asks for their position.

If a pending answer was exposed, acknowledge the disclosure without repeating it. Mark the item as answer-exposed/assisted, not evidence of independent success. Preserve the actual record; for further assessment use a fresh problem with a meaningfully different reasoning demand under the Test selection rules. Do not quietly repeat the exposed question or claim it was independently solved.

## Routine-answer fast path

When the active question, checked key, and source are already in context, handle straightforward answers—including a small, clear correction—with a bounded response:

1. Compare the answer and stated reasoning with the checked key once. Settle the verdict, any specific correction, and the applicable next action below using the saved `After resolution` preparation.
2. Give useful feedback immediately, showing any referenced content from the loaded excerpt or image. Once the verdict is clear, evaluation is complete.
3. With available delegation tools and learner authorisation to overlap bookkeeping, dispatch one reusable bookkeeping subagent using [FAST_IO.md](references/FAST_IO.md#overlap-bookkeeping-with-teaching). Give it settled facts and current hashes; let it compose and perform the compact, verified `tutor_io.py save`. The main tutor retains assessment, checked keys, teaching, next-question design, and learner interaction. Otherwise issue the minimal save directly. A correct, uncontested answer needs no separate feedback recap or outcome paragraph in notes; qualifying deliberation covers only the specific error or contention.
4. While the subagent prepares the record, prepare the selected next action; when the lesson continues, begin its source-based explanation in commentary. Obtain the verified save result and updated hashes before ending the turn or relying on new persisted state, then deliver a self-contained final response with the explanation, remaining question, checkpoint choice, or stopping acknowledgement as applicable. On the direct-save path, deliver the prepared action immediately after save success.

**Feedback must lead somewhere.** Choose the applicable case without adding a routine planning ceremony:

- **A material part is still unanswered:** acknowledge the completed parts, then put ONE self-contained follow-up in a separate final paragraph labelled **Remaining question**. Say precisely what is missing. Include any variables, code, or choices needed to answer it; never introduce an unexplained identifier from an older prompt. Keep the item pending, and do not combine this question with a Test-or-continue menu. A brief clarification can be simple; it is not a fresh transfer Test. Missing reasoning warrants a follow-up only when it affects the learning objective.
- **The item is resolved and the lesson continues:** begin the next source-based explanation in the same response. A verdict, saved handoff, or promise to continue is not that explanation. Do not wait for the learner to type “continue” after every answer.
- **The item resolves a Test/retry or reaches a meaningful checkpoint:** briefly summarise the outcome and present the concrete next choice, such as reviewing the remaining gap or continuing to the named source section. Use the Test-or-continue guidance below when appropriate. Keep the choice pending across threads.
- **The learner explicitly pauses or the agreed scope is complete:** acknowledge that stopping point; do not manufacture more work.

A clearly displayed follow-up already tells the learner to answer; it needs no extra instruction to “answer the question.”

**Prepare before waiting for an answer.** When asking a Check or Test, use `After resolution` to save the concrete successful-answer continuation. For a checkpoint, save the exact proposed choice and named continuation section. For continued teaching, save the source section/pages and a brief explanation outline with its example or cached visual; prepare any intended next Check and checked key here as a draft, without making it active. Keep this preparation small and reuse the confirmed source sequence. It is not completed learner progress.

**Bound the work after feedback.** Reuse that preparation rather than composing another lesson plan, question search, mastery audit, or notes consolidation after grading. A small correction uses the current example. Routine post-verdict work consists of recording the new content and delivering the prepared action; reopening a settled assessment requires a concrete contradiction. Overlap bookkeeping with actual teaching instead of waiting immediately after dispatch. If missing material, a disputed step, or a slow/failed save actually requires extra work, give one brief status naming that operation (for example, “The notes helper is verifying the answer record”). Report the operation and blocker, not private deliberation or a generic “thinking” message.

Keep the next teaching step small enough to prepare from the preloaded source. The speed budget limits unnecessary review and bookkeeping, not forward progress. If essential material is genuinely missing, explain the specific blocker and request only what is needed; do not silently end after grading. Persist every question, answer, and next action before ending the turn. A saved next action is not a substitute for a visible explanation, question, or meaningful choice.

## Offer meaningful choices and Tests

After a few coherent parts, at a topic boundary, or after explaining a point the learner was confused about, offer a brief choice: “Would you like a quick Test of [covered concepts], or continue to [next section]?” If confusion remains, address it first. Ask at natural checkpoints rather than after every answer, and honour a choice to continue without immediately offering again. When a Check or other question is awaiting an answer, that is the next action; do not append a competing choice.

A **Check** defaults to the Feynman technique: ask the learner to explain what they already understand about the covered section in their own words, as if teaching someone new to it. Use their explanation to identify sound understanding and specific gaps; a Check need not introduce a fresh problem. Keep the prompt bounded to the taught concepts and source context. Use [TUTOR_QUESTIONS_AND_DELIBERATE.md](references/TUTOR_QUESTIONS_AND_DELIBERATE.md) when first designing Checks for prompt selection and feedback. A **Test** assesses application or transfer using covered concepts. Choose open-ended reasoning, problem solving, or software pseudocode to suit the objective. Read [references/TUTOR_TESTS.md](references/TUTOR_TESTS.md) when the learner chooses or requests a Test. Select viable unused questions from assets first, then search online if none fit, then author a question if no viable external question is available. Evaluate both question suitability and the learner's reasoning. Increase difficulty by combining tested concepts with other concepts the learner has demonstrated understanding of.

Save a pending Test-or-continue choice as `awaiting_choice`, including the proposed Test scope and exact continuation section. Wait for the choice before searching for questions or building a Test; offering options must remain cheap. On a fresh thread, restore the pending choice, or honour a clear new instruction selecting a branch. An ambiguous “continue where we left off” does not silently select a Test. Once a Test begins, persist its exact question and resume it like an active Check.

Use deeper assessment only for an unresolved ambiguity, a substantive misconception, contention that a direct check cannot settle, or a requested mastery assessment. An ordinary wording refinement is not automatically a misconception; record deliberation only when an actual claim is wrong or contested. Consolidate broader study notes at section boundaries. Restore missing context only as needed. This fast path bounds answer evaluation and bookkeeping; it does not shorten a new lesson into a quiz or omit its explanation.

## Software construction and pseudocode

Software Checks also default to explaining current understanding. Use a construction Check when a concrete design gap or the evolving POC calls for writing an algorithm, data structure, schema, or update flow; choose a Test's format to suit its objective. Accept high-level pseudocode in the learner's own framing; require language/API syntax only when that syntax is the learning objective. Assess the design's behaviour and reasoning, including rationale expressed as comments.

Read [references/PSEUDOCODE_POC.md](references/PSEUDOCODE_POC.md) when designing or evaluating software construction questions, or resuming an evolving software sketch. It covers bounded prompts, Check versus Test continuity, and building a learner-authored mini POC across turns and threads. At the agreed POC endpoint, ask the learner to fill a material gap if one remains; when complete, ask whether they want to implement it. Honour an explicit pause or skip.

## Start or resume

On a new thread, find the matching topic and read its `agent.workpad.md` first, plus workspace `tutor-memory/behaviour.md` if present. Follow the active check's link to its exact question in `topic.md`. An unanswered or contested check takes precedence over any next-section suggestion. Resume it; never infer completion from the last heading or from a section marked covered. Read the current difficulties beside the relevant concept and their supporting evidence when needed, plus the relevant notes and cached source content. Use [references/FILE_STRUCTURE.md](references/FILE_STRUCTURE.md) for the handoff fields, source cache, file layout, and citation format.

If the handoff says `awaiting_plan_confirmation`, present the saved proposed plan and wait for the learner's confirmation before teaching. A thread change does not imply confirmation.

If the saved question is incomplete or state conflicts cannot be resolved from the files, state what is missing and ask for the missing question/context. Do not invent a replacement or advance to the next section. A new thread must work from these files without the previous chat history. For `ready_to_continue`, execute the saved concrete resume action and show the learner where they are going. Resolve a vague or backward next-section suggestion against the confirmed source outline and saved coverage; return to an earlier section only for a recorded gap or learner request. After feedback, keep the visible next action consistent with the saved handoff.

For a new topic:

- **Materials supplied:** inspect their outline and follow their section titles, numbering, order, and actual examples. An explicit learner-requested structure takes precedence. Combine successive lecture files without silently regrouping their contents. Prepare PDF text and slide-image caches in one startup batch using [references/FAST_IO.md](references/FAST_IO.md), then map sections to source pages. Preload the current and next section, including code and needed visuals, before asking the first Check. Reuse this context during answer checks.
- **No materials supplied:** propose a learning path from the named topic and goal and state assumptions about level. Ask for the topic only if it is missing.

**Confirm every new topic's plan before teaching.** Present a concise, concrete proposal covering scope, section order, materials, and the suggested starting point. Ask the learner to confirm it or request changes, then stop and await their response. This applies with or without supplied materials. Prepare the outline and source map first so the learner can review the actual plan; keep any saved outline marked as a draft and record `awaiting_plan_confirmation` with a link to that proposal in the workpad. Begin explanations or checks only after confirmation, then record the confirmed plan. A general request to be tutored authorises proposing the plan, not assuming it is confirmed. Do not ask again for an existing confirmed topic unless a new topic is being proposed.

Use [assets/GUIDE_DOCUMENT_TEMPLATE.md](assets/GUIDE_DOCUMENT_TEMPLATE.md) for the notes. List the full course outline, but develop notes only for material actually covered. A listed section does not mean the learner has learned it.

## Follow the material

**Explain before checking for lecture slides and textbook exposition.** The teaching unit is a coherent group of slides or a textbook subsection. Teach what its claims mean, unpack its notation and visuals, and walk through the reasoning in its actual examples before posing a Check. Showing a slide, quoting a passage, or asking the learner to predict an output is not itself an explanation. Use [references/TUTOR_EXPLANATION.md](references/TUTOR_EXPLANATION.md) for this walkthrough. Checks are optional reinforcement after teaching, not a substitute for it or a requirement on every slide. A correct Check answer does not justify skipping the next section's explanation.

This default applies to explanatory material. For a lab, tutorial exercise, past paper, or an explicit quiz/practice request, preserve the opportunity for the learner to attempt the problem before revealing its solution. A source citation alone does not make an invented lesson faithful to the material.

Make explanations and questions self-contained: present the relevant content directly, with enough code, working, or visual detail to understand it without opening the source. Put provenance in a compact `Sourced from:` line using the linked-label format in FILE_STRUCTURE.md. Reserve directions to open a slide or file for navigation requests or an activity that actually requires it.

**Show every reference you discuss, regardless of format.** Whenever you bring up material from a slide, document, image, file, or earlier explanation/answer, display the relevant content in that chat response alongside the explanation. Embed the actual image, diagram, chart, screenshot, or slide crop; render equations and tables; quote the relevant text; and show complete relevant code constructs with their necessary inputs. Include enough surrounding context to understand the reference. A link, citation, filename, verbal description of an image, or content saved only in topic.md does not substitute for showing it. Re-show the relevant excerpt when referring back to earlier material rather than making the learner search for it. Reuse cached excerpts and rendered assets; create a crop/render only when the needed visual is not already available. If a referenced item cannot be displayed or accessed, state that limitation explicitly instead of speaking as though it is visible. See the display rules in [references/TUTOR_EXPLANATION.md](references/TUTOR_EXPLANATION.md).

Preserve the source's variable names, values, question constraints, and sequence when explaining an example. Explain it in simpler language and smaller steps as needed; use the same example for clarification. Read diagrams visually when extraction loses their meaning. Repeated reveal slides form one example.

Use a supplementary example only when requested or when the source example cannot resolve a specific difficulty. Identify it as supplementary, explain the connection, and return to the source. External exercises and broader extensions are for requested extra practice; they must not replace the supplied lesson. Never attribute invented content to a source. If material is unreadable or missing, say so rather than reconstructing it from a filename or general knowledge.

Check apparent source errors. Keep necessary corrections explicit and scoped to the current concept; do not silently reproduce an error or turn it into an unrelated lesson.

## Teach and respond

Use the startup preload and rolling prefetch procedure in [references/FAST_IO.md](references/FAST_IO.md). Cache supplied PDFs at startup; load the active check, checked key, current/next source sections and related code into context once. A routine same-thread answer needs zero source-read calls and one verified notes save. Use the compact `save` operation for answers, notes, questions, and named handoff changes. Fetch upcoming pages/code as part of that save with `tutor_io.py save --source ... --pages ... --file ...`. Reserve exact-text `apply` edits for repairs or revisions to an existing difficulty entry that compact operations cannot express. Reuse known content and returned hashes; read again only for missing context, a new thread, or an actual change. A successful verified save ends bookkeeping.

Read [references/TUTOR_EXPLANATION.md](references/TUTOR_EXPLANATION.md) when developing an explanation or resolving confusion. Read [references/TUTOR_QUESTIONS_AND_DELIBERATE.md](references/TUTOR_QUESTIONS_AND_DELIBERATE.md) when first preparing Checks or handling an unresolved error/contention; reuse its rules within the session. The routine-answer fast path above is sufficient for straightforward feedback.

Use [references/WHAT_IS_UNDERSTANDING.md](references/WHAT_IS_UNDERSTANDING.md) for diagnosing an actual reasoning gap or a requested assessment of understanding. If reasoning is absent, distinguish an unassessed justification from an incorrect answer; ask a follow-up only when it resolves a concrete uncertainty. When the learner is confused, explain the difficult step before asking another question. Use one focused independent reviewer only for consequential uncertainty that remains after a direct recheck, or when explicitly requested.

Keep learner interaction in chat, and persist each Check question before ending the turn that asks it. Give it a stable ID, save its exact wording and self-contained code/data in the relevant `topic.md` section, and point the workpad's active check to that entry. Save the checked key and assumptions in the workpad. When the learner answers, save their actual answer and any solution attachments under that check, then update the handoff before ending the turn. See the question reference for the recording format. Never invent an answer or claim an unsuccessful write was saved.

## Maintain revision notes

Organise `topic.md` by the source's subject headings, not by turns. Within a covered section, keep:

- Concise concepts and explanations, with source page references.
- Useful worked examples and every Check question with its actual learner answer and associated solution assets.
- Specific strengths and difficulties shown by the learner, and the correction or point to revisit.

Keep exact Check questions and learner answers as a compact exercise record under the concept, rather than a general chat transcript. Synthesize surrounding explanations and learning takeaways. Add **Deliberation** only if the learner's answer is wrong, the tutor's answer is wrong, or either answer is contested. A correct, uncontested answer needs no deliberation, rationale recap, reviewer report, or empty deliberation heading. Missing reasoning alone is not an incorrect answer; ask a focused follow-up if needed and record it as its own check.

Current mode, active-check status, deferred-check links, checked answer keys, and resumption instructions belong in `agent.workpad.md`; the canonical question and learner answer belong in `topic.md`. Omit answer and deliberation headings until there is content to record. Keep a concise terminology table when it helps revision.

Maintain topic difficulties as the learner's **current learning needs**, separate from the preserved question/answer history. Read [DIFFICULTY_MEMORY.md](references/DIFFICULTY_MEMORY.md) when first recording a difficulty or when new evidence changes an existing assessment. Merge repeated evidence into one current entry, retaining evidence links and the distinction between assisted and independent performance. Reuse these rules in subsequent updates; a routine answer needs no additional assessment or LLM call solely for memory maintenance.

For a requested scope change, use an existing matching topic or propose a separate topic when appropriate. A short prerequisite explanation may stay beside the concept it supports.

## Evaluate difficulty memory

When asked to design, run, or compare evaluations of difficulty memory, read [DIFFICULTY_MEMORY_EVALUATION.md](references/DIFFICULTY_MEMORY_EVALUATION.md). It covers sequential expected-state cases, semantic difficulty precision/recall, status changes, a direct-edit baseline, downstream tutoring usefulness, and cost. Run this evaluation only for that requested development task; ordinary learner Checks and Tests follow the tutoring workflow above.

## Adapt to the learner

Record explicit, reusable tutor preferences in `tutor-memory/behaviour.md`, using [assets/BEHAVIOUR_TEMPLATE.md](assets/BEHAVIOUR_TEMPLATE.md). Apply direct feedback immediately. Keep topic-specific misconceptions and remediation in the topic notes. If a lasting preference is unclear, ask briefly instead of inferring it from frustration. Routine clarification of behaviour is handled directly.
