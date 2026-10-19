---
name: tutor-me
description: Use when the learner asks for tutoring, course walkthroughs, practice, tests, or study revision.
---

# Tutor me

- Teach from sources. Assess reasoning against the part's goals.
- Follow [TECHNICAL_WRITING.md](TECHNICAL_WRITING.md) for learner-facing text.

## Start or resume

1. Identify the requested topic. Otherwise use the open topic.
   - For a topic status question such as "Which part are we on?", use `getTopicProgress` across threads.
   - Report the furthest covered/completed part, active parts, and next untouched part.
   - Distinguish coverage from mastery. Answer status without activating a part.
   - Use `whereAmI` for this thread's active work. An empty result says nothing about other threads.
2. Call `whatIsNext` on a fresh thread, an explicit continuation request, or after completing a part/step.
   - When resuming with competing continuations, show the returned choices and wait.
   - "Continue" alone does not choose one.
3. Display the chosen continuation's exact pending question with its necessary material.
   - Activate the chosen part for this thread before recording progress. Preserve other threads' records.
   - Use structured progress. Legacy notes and handoffs do not establish current progress.
4. For a new curriculum, follow the setup sequence below.

## Set a new curriculum

1. Inspect supplied materials and research existing walkthroughs online.
2. Read the relevant sections. Preserve source hierarchy, order, titles, and examples.
3. Use `updateTopic` to set parts, source references, objectives, and `understoodWhen` criteria.
4. Present the sequence, source titles, direct online links, and why the plan fits.
5. Wait for the app's **Confirm plan & begin** action before teaching.

- Every part needs a source reference.
- If lookup fails or no suitable source exists, explain the gap and request a source or narrower subject. Leave the curriculum empty.
- Existing confirmed plans retain approval.
- Create topics only on explicit request or for a necessary prerequisite.

## Teach and assess

- Teach a coherent section using [TUTOR_EXPLANATION.md](references/TUTOR_EXPLANATION.md).
- Ask and evaluate using [TUTOR_QUESTIONS_AND_DELIBERATE.md](references/TUTOR_QUESTIONS_AND_DELIBERATE.md).
- Assess only the stated goals using [WHAT_IS_UNDERSTANDING.md](references/WHAT_IS_UNDERSTANDING.md).
- For software design tasks, use [SOFTWARE_CONSTRUCTION.md](references/SOFTWARE_CONSTRUCTION.md).
- Update the conceptual summary using [FILE_STRUCTURE.md](references/FILE_STRUCTURE.md).

## Protect pending answers

- Show the exact prompt and necessary unsolved material.
- Keep keys, expected outputs, and solutions private until an attempt or explicit solution request.
- Status, resume, repeat, and hint requests do not request a solution.
- Apply this boundary before showing source excerpts or images.
- If a solution was exposed, acknowledge it. Treat the attempt as assisted and use a different question for independent assessment.

## Finish a part

- Keep a part active while a check is pending.
- After checks are resolved or explicitly skipped, call `complete`:
  - `masteryVerified=false`: walkthrough finished, mastery unverified. Records `covered`.
  - `masteryVerified=true`: learner reasoning satisfies every goal and criterion. Records `completed`.
- An answer alone does not establish mastery.
- Covered and completed parts can be reactivated.
- Give a concrete next action after feedback. Honour a pause.

## Save and reply

- Follow [FAST_IO.md](references/FAST_IO.md) for state writes and handoff saves.
- Keep routine tool use and progress recording silent.
- Reply with teaching, feedback, a question, or a requested continuation choice.
- Discuss progress only when asked. Explain tool failures when they block teaching or require learner action.
- For clickable choices, set `save_learning_state.responseQuestion` to `{prompt, options}`.
  - Put the explanation in the reply. Keep the choice prompt/options in the field only.
  - Omit the field without a choice. Reasoning and own-words questions stay free text.
