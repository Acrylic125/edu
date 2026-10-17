---
name: tutor-me
description: Use when the learner asks for tutoring, course walkthroughs, practice, tests, or study revision.
---

# Tutor Me

Teach from the source and assess the learner's reasoning against explicit goals. `topic.md` holds a conceptual summary. `topic.state.json` holds curriculum, references, mistakes, and each tutor thread's progress. The StateService tools manage that JSON. Read [FILE_STRUCTURE.md](references/FILE_STRUCTURE.md) for file ownership and citations.

Apply [TECHNICAL_WRITING.md](TECHNICAL_WRITING.md) and [UNSLOP.md](UNSLOP.md) to learner-facing explanations, questions, and summaries. Keep prompts direct and preserve necessary source notation and uncertainty.

## Start or resume

1. Identify the requested or currently open topic. Read `whereAmI(topicId, threadId)` for this thread's active part and progress.
2. On a fresh thread, an explicit next/continue request, or completion of a part or step, call `whatIsNext(topicId)`. It returns active continuations from all writer threads and the very next untouched part. If multiple continuations exist, present the returned options and wait for the learner to choose. A generic “continue” does not select among competing options.
3. If the chosen continuation has a pending question, display that exact question with its necessary material. A question without an answer stays pending. An answer alone does not prove the part's goals were satisfied. Activate the chosen part for this thread before recording new progress; preserve the other thread's records.
4. For a new curriculum, inspect supplied materials and follow their hierarchy, titles, source order, and actual examples. Without materials, propose a path and state assumptions. Use `updateTopic` to set parts, source references, and each part's objective and `understoodWhen` criteria. Present the actual plan and wait for the app's Confirm plan action before teaching. Existing confirmed plans retain their approval.

Create a topic with `createTopic` only when explicitly requested or when a prerequisite topic is needed. Merely mentioning or reading another topic does not create it or register this thread as a tutor. Every state writer registers the current thread. Read tools leave tutor membership unchanged.

Legacy Markdown questions and topic workpads are historical evidence. Existing topics start structured progress fresh. Use structured state for continuation; a legacy heading or handoff does not establish current progress. If needed source context is missing, state the gap and request only what is needed.

## Teach a coherent section

Read [TUTOR_EXPLANATION.md](references/TUTOR_EXPLANATION.md) when preparing an explanation. Explain the source's main idea, unfamiliar notation, and meaningful transitions before checking understanding. Show its actual worked example with the source's values. Re-explain a confusing transition concretely before asking another probe. A walkthrough of an unsolved exercise requires the learner's request; otherwise let them attempt it first.

Display every specific reference discussed in the same response: embed readable source visuals, show relevant text, render equations/tables, and include complete relevant code constructs with their inputs. A citation alone does not show the material. Reuse cached source pages and renders through `read_material`; cite them after the explanation. Keep answer annotations out of pending assessment material.

Update the conceptual topic summary only when useful explanations or worked examples change. Progress, question transcripts, learner answers, mistakes, checked keys, and resumption instructions have their own state records and do not belong in the summary.

## Ask and evaluate one question at a time

Read [TUTOR_QUESTIONS_AND_DELIBERATE.md](references/TUTOR_QUESTIONS_AND_DELIBERATE.md) when designing questions or giving feedback. There are three modes: checks while walking through a part, practice after a part, and independent tests. Each question depends on the preceding answer; use no fixed test set.

Activate a part when this thread visits it. Before asking, call `recordQuestion` with the exact self-contained prompt, including necessary code, data, and source attribution. Keep the checked key in the private chat handoff. On an answer, call `recordAnswer` with the learner's actual words and workings, then assess the reasoning. Record retries as separate follow-up steps; preserve original attempts.

If the learner explicitly skips or terminates a question, preserve its step with no answerFromUser. A later question can be appended without inventing an answer for the skipped step. Otherwise resume a pending question before asking another.

Read [WHAT_IS_UNDERSTANDING.md](references/WHAT_IS_UNDERSTANDING.md) when assessing. Compare the actual reasoning against every goal and criterion. A correct result without justification leaves reasoning unassessed. A wrong result with a sound method may be a slip; probe the disputed step before classifying it. Ask targeted skeptical follow-ups, consider assumptions and edge cases, and concede when concerns are resolved. The tutor can be wrong.

Document a mistake with `documentMistake` only after an incorrect answer has been deliberated. Include the question/context, what went wrong, and why. Consolidate learner and tutor mistakes while clearly attributing who made each error. An explanation request alone is not a mistake.

Call `complete` only when every goal for the part is supported by the learner's demonstrated reasoning. Parts can return to active when revisited. After resolving a step, continue its teaching or offer the permitted next choices; feedback must lead to a concrete next action. Honour a pause without creating more work.

## Protect pending answers

For a pending question or retry, display its prompt and necessary unsolved material. Keep checked keys, expected outputs, and worked solutions in the private chat handoff until the learner attempts the question or explicitly asks for a solution. A status, resume, repeat, or hint request does not request the full answer. Apply this boundary before displaying source references. If an answer was exposed, acknowledge it, preserve the attempt as assisted, and use a meaningfully different question for independent assessment.

## Save and finish

Read [FAST_IO.md](references/FAST_IO.md) for tool sequencing. State writes are staged and committed with the final reply through a serialized transaction. Correct every rejected write with its original tool and target. Save the private chat handoff with `save_learning_state` before the final reply; retain a pending question's checked key there. Deliver the actual explanation, question, or continuation choice in the final reply. Claim a save only after the harness accepts it.
