---
name: manage-topic
description: Manage scratchpads of type, "topic". Extract "type" from `{scratchpad}.scratchpad.state.json`
---

# Manage Topic

## Topic flow

1. Create and confirm the source-linked topic plan.
2. Establish one running example that connects the topic's parts.
3. Work through the source sections in order. Teach one objective, ask a story-related check, and resolve gaps in the learner's reasoning.
4. Extend the walkthrough from the learner's supported explanation, then continue to the next objective.
5. Before moving to the next highest-level part, offer the learner a choice to proceed or do quick practice. Wait for their choice.

## Creating Topics

Steps:
1. Identify the requested subject, scope, and level before creation. An explicit `/new-topic` command goes directly to the planner. If scope is missing, ask a focused clarification.
2. Use the cached document index to select curriculum section IDs. The host supplies the selected text with `select_topic_sections`. Use visuals only when source headings or figures are ambiguous. Reserve practice attachments for later practice instead of citing them to retain the files.
3. Without supplied curriculum sources, use web search to find suitable official documentation, textbooks, university materials, or primary publications. Read candidate pages with `inspect_web_source` to obtain host-issued section IDs. If reliable coverage is unavailable, use `request_topic_clarification`.
4. Submit the title, selected section IDs, and concise learning goals with `submit_topic_plan`. Preserve source order. The host constructs references and stages the topic. Raw file paths and page ranges are not planning inputs.
5. End the invocation after submission. The host validates and commits, then renders the saved plan and confirmation request. Do not write a second summary, handoff, lesson, or question sequence.
6. After learner confirmation, use the teaching tools to guide the learner through the sections. A requested plan revision returns to the planner before teaching resumes.

## Explaining
[Explain in this style](WRITING_STYLE.md).

## Asking Checks and Questions

2 Scenarios,
1. Walking through a topic (Checks)
2. Practice after a topic part (After 1)

Read [What is understanding](WHAT_IS_UNDERSTANDING.md) before choosing a check, practice question, or follow-up. Ask one question at a time and wait for the learner's answer. Select questions dynamically rather than preparing a fixed set.

Before sourcing each check, practice question, or follow-up:
1. Establish the taught scope from the saved source position, chat handoff, and recorded learner evidence. Use `read_topic_evidence` for relevant parts when the history is incomplete. A planned goal, active/completed label, source page read, or saved scratchpad heading alone does not establish coverage. Checks may assess the objective just explained; practice uses only concepts actually taught before practice began.
2. Compare the candidate with recorded questions and answers from the current and earlier relevant parts using `topic_getQuestions` or `read_topic_evidence`. Skip an already asked example check; use its recorded answer to assess the objective. Treat rewording, changed registers or values, and a different opcode testing the same operand-position rule as the same check. Preserve unresolved gaps, but assess them with a different reasoning task rather than repeating demonstrated components.
3. Identify every concept, method, notation, and prerequisite needed for the proposed answer. Match each to that teaching evidence. Narrow the question to the covered portion or choose another source if any requirement is untaught. Keep missing curriculum objectives for the next teaching turn; practice is not a shortcut for introducing them.
4. Inspect the source using `read_material` for attachments or provider web tools for online content. Apply the sourcing branch below, then the diagnostic criteria in [What is understanding](WHAT_IS_UNDERSTANDING.md). Keep the source locator, covered concepts, and intended reasoning private in the handoff. Cite the original page or exercise beside the question and label adaptations or invented examples honestly.

When resuming an out-of-scope practice question, withdraw it, retain the answer history without treating the untaught requirement as a learner mistake, and replace it with an in-scope question.

Record each check and follow-up once with `topic_recordQuestion`. Select its recorded step with `pendingCheck` in `save_learning_state`. The app displays the question.

### 1. While walking through a topic
Topic evaluation happens as the topic is being walked through. 

Use lecture/textbook explanations and worked examples to teach the current objective. Follow the source's section order and cover its substantive concepts, formulas, figures, code, and worked examples within the agreed scope. Keep required source examples and their inputs even when they differ from the running example; explain their connection to it.

Source the check from a worked example in the attached slides first, or an attached curriculum textbook example when appropriate. Read the relevant example before adapting it. If no suitable example exists, create one and identify it as an original example. Without attachments, use the inspected curriculum source's example or create one.

Use the example's setup to ask for an unresolved prediction, calculation, diagnosis, or justified design decision within the current taught objective. Withhold its worked answer and change a meaningful assumption, constraint, or failure case when the solution has already been shown. Preserve required source examples in the lesson; a check should require applying them rather than recalling their result. Connect the reasoning back to the running example after assessment. The story supplies continuity, while the source example supplies the assessment task.

Reserve tutorial questions, worksheets, problem sets, and their solutions for practice. Keep those questions out of the guide, scratchpad walkthrough, examples, and understanding checks, including paraphrases or versions with changed values.

### 2. Practice after topic part
Can happen right after (1) of a topic part OR at the end of the topic.

At the end of a highest-level curriculum part (a part with no `parent`), including its child parts, ask: "Would you like to proceed to [next part name] or do a quick practice question on this part?" Pause before teaching or activating the next highest-level part. Transitions between objectives or child parts within the same highest-level part continue normally.

Save this navigation choice with `save_learning_state`, phase `awaiting_choice`, the prompt in `question`, and `responseOptions` labelled "Proceed" and "Quick practice". In `nextAction`, identify the completed highest-level part and the next part, and wait for the learner's choice. This choice is not an understanding check; keep it out of the recorded assessment questions.

Resolve the learner's latest choice against the saved navigation prompt before taking any teaching action. "Quick practice" and "Keep looking for practice" both select sourcing for the completed part. Stay at that boundary until practice is resolved or the learner explicitly chooses to proceed. When no eligible question can be verified, state the limitation honestly, save phase `awaiting_choice` with "Proceed" and "Keep looking for practice", and wait. Failure to source practice does not select Proceed. Keep the next-part teaching instruction in the handoff conditional on that new choice.

If the learner chooses quick practice, ask one short application question on the completed part using the sourcing rules below. Assess their answer and resolve any specific gap, then offer the proceed-or-practice choice again before moving on. If they choose proceed, begin the next highest-level part.

1. Retrieve the topic's recorded questions (`topic_getQuestions`) to avoid repeating an exercise or its reasoning task.
2. Inspect attached tutorials, textbook practice questions, worksheets, or problem sets first. Select an unused exercise that can assess the completed part using only the taught scope.
3. If no suitable attached exercise is available, search online for a university, textbook, exam, or exam-preparation exercise, as when sourcing a test question. Inspect the actual question and retain its URL and exercise identifier or page. If search is unavailable or no suitable exercise can be verified, explain the sourcing limitation and keep the proceed-or-practice choice open. An invented practice question is not a sourcing fallback.
4. Reframe the sourced exercise to the already taught portion: select a self-contained subpart, remove requirements for later methods, and supply incidental context as givens. Preserve a substantive reasoning task and accurate source attribution; label the question as adapted and retain the original exercise locator. If solving it still requires an untaught concept, choose another exercise. The source's full requirements do not override the taught scope.

Keep each question focused on one objective while requiring the learner to select and apply a method, diagnose a failure, justify a design, or infer a consequence. Difficulty comes from reasoning with taught concepts. Connect that reasoning to the running example without forcing every source exercise into its setting. After assessment, use the learner's supported explanation to improve the corresponding story step. Keep practice statements and worked solutions in the question history rather than copying them into the walkthrough.

## Feedback and Deliberating
After the user answers, give [FEEDBACK and DELIBERATE on the answer](FEEDBACK_AND_DELIBERATE.md)

Record the actual answer with `topic_recordAnswer` before using it in the walkthrough. Preserve previous attempts and document confirmed mistakes for the part.

Resolve a specific conceptual gap with an explanation and one diagnostic follow-up before advancing. Use cumulative learner evidence to decide whether a gap remains after a correction. If the learner requests a skip, retain the unresolved objective and source position in the private handoff for later review.

## Maintain Scratchpad

Build one worked example through the learner's explanations. The assets determine what must be addressed; the learner's reasoning determines when to advance. Keep assessments of who said or understood what in structured progress and private handoffs.

1. Choose a lecture/textbook example or create one that connects the topic's parts. Save its goal, concrete inputs, and relevant setup visual on the first teaching turn. Distinguish invented inputs from source data. Leave conclusions for pending checks private.
2. After assessing an answer, read the relevant recorded answers and current story blocks. Add or revise the corresponding step with a faithful, lightly edited version of the learner's supported explanation. Preserve their vocabulary and causal reasoning. Edit grammar, notation, and formatting without inventing claims they did not demonstrate.
3. Pair that explanation with the relevant inputs, working, result, and visual. Use the example's values in labelled Mermaid diagrams, field tables, or Plotly plots; retain source figures when examining them. Preserve source terminology and link required source examples back to the same story.
4. If an answer is wrong or vague, teach and probe the missing reasoning before finalizing that story step. Save useful source setup and terminology as needed, while keeping unsupported conclusions out of the walkthrough. Once the gap is resolved, use the learner's corrected explanation. Preserve earlier working and stable block IDs.
5. Before advancing, check the current objective against its source content and `understoodWhen` criteria. An answer about one required concept leaves other concepts open. Track remaining concepts, source examples, and unresolved reasoning in the private handoff. Complete a part only after all its goals are supported by recorded learner evidence.

For example, a learner may explain that `sum(2)` must keep its own `n = 2` while `sum(1)` uses `n = 1`. Use that explanation for separate local storage. If the assets also teach return information and frame removal, teach and check those next. Add their explanations after the learner supplies the reasoning.

Before saving, verify that each new explanatory claim follows from the recorded learner reasoning or necessary source setup. Preserve the source scope and earlier working. Keep the walkthrough readable as one story, with concrete working or an illustrated explanation for each resolved objective. Use the topic template for presentation.

## Scratchpad format

Apply this format only to the topic scratchpad. Keep chat explanations self-contained and conversational using WRITING_STYLE.md.

Build a slide-like walkthrough in Markdown: one idea per step, with 1–2 short lines of explanation immediately followed by a visual. Repeat this explanation → visual rhythm as the worked example develops. Use blank lines between the explanation and visual, and `---` between steps. Keep the app-generated section headings; add a short step heading only when it clarifies the idea.

Each visual must teach the preceding point: a labelled plot, Mermaid diagram, relevant table, source figure, or code excerpt. Use the supported visualization markup from WRITING_STYLE.md. Render the actual visual rather than writing a placeholder such as “plot of circle”. Split longer reasoning into additional steps rather than a dense paragraph. Show equations beside the short explanation and pair quantitative relationships with a plot; a formula alone does not replace that plot.

For example, after assessing the learner's explanation of $x^2 + y^2 = r^2$, save their reasoning beside a labelled circle plot. When they explain the role of $r$, extend that step with a radius segment for $r = 2$ and equal axis scales. Continue from the same example, changing one idea at a time.

Before saving, verify that every step pairs a short explanation with a relevant rendered visual, stays within taught concepts, and preserves earlier working. This changes document presentation only; retain the existing curriculum, progress, questions, mistakes, stable block IDs and state schema.

## Structured content

`scratchpad.state.json` owns the curriculum, explanations, terminology and learning evidence. `scratchpad.md` is generated by the app.

Read the current state before changing content. Use `topic_editContent` with an ordered `changes` array:
- `add`: supply a new block with a unique stable ID. Use `afterId` to place it after another block, or `afterId: null` to place it first.
- `edit`: supply the complete replacement block with the existing ID.
- `delete`: supply the existing block ID.

All changes in one call succeed together. Keep IDs stable across wording changes. Use `sectionId` to associate an explanation with its curriculum part. Use a `source` block with `materialId`, `page` and `presentation` (`link` or `image`) for a citation or slide.

Save new and revised walkthrough steps with `topic_editContent`, omitting `present` by default. Write the chat explanation or feedback in the normal final reply. Only when the learner explicitly asks to show stored blocks in chat, set `present` to their ordered IDs; the app renders them and the recorded check, so omit a duplicate final explanation.

The app creates the directory, anchors, section headings, citations and final terminology table. Use `topic_updateTopic` for requested curriculum or metadata changes. Record questions, answers and progress with their dedicated tools. Keep private assessment keys in the chat handoff.

## Topic terminology

Maintain an index of the named concepts taught in this topic. When saving an explanation, add its new terms in the same `topic_editContent` call. Each `term` block needs a stable `id`, the `term` as used in the document, and a concise `meaning` grounded in the explanation and inspected sources. Save the definition as soon as the concept is introduced, before completing the teaching turn.

The current target's `terminology` lists saved term IDs and names. Read existing definitions with `read_scratchpad` before revising them. Reuse the existing ID for the same term, including differences in capitalization, and preserve earlier entries.

When continuing an existing topic, backfill missing terms from its saved taught explanations before adding the next lesson. Read those explanations with `read_scratchpad` or `read_topic_evidence`. Include only concepts already taught. An empty index needs term blocks, even when the generated document already shows a terminology table heading.

The app uses these blocks for the terminology table and definition popups on highlighted document text. Save glossary entries as `term` blocks rather than a Markdown table in a lesson block.
