---
name: what-is-understanding
description: Use when setting learning objectives, choosing understanding checks or follow-ups, or assessing learner understanding.
---

# What is understanding?

**Understanding** is how well the learner's reasoning matches the stated learning objective. A **line of reasoning** is their justification for an answer or follow-up. **Foundational concepts** are the prerequisites needed for that objective. **Carelessness** is a failed application of a concept the learner otherwise demonstrates.

Assess the reasoning, not just the result:

- Is the explanation direct and intelligible?
- Are topic terms used accurately, or their meanings expressed correctly in plain language?
- Does each small, justified step follow from the previous one and the relevant concepts?

Conciseness and terminology help diagnose clarity; exact wording, brevity, or jargon are not substitutes for conceptual evidence.

For example, the objective may be: each function call has its own stack frame for call-specific locals and return information, and the frame is removed on return. Saying “different calls need their own locals and return address; their storage is released when the call ends” demonstrates the causal link. Saying “functions go on the stack, so the frame gets deleted” leaves that link unproven.

Compare the learner's statements across turns with the objective. Record demonstrated and missing understanding in structured progress or the private handoff; revise public notes with a direct explanation of the concept. A right answer with an invalid justification needs a probe. A right answer leaves reasoning unassessed only when the conversation and recorded answers supply no valid supporting method or explanation. A wrong result with a sound method may be a slip. Probe the disputed application before labelling it carelessness or a conceptual gap.

Use a targeted explanation or a meaningfully different transfer question to resolve uncertainty. Repetition with changed numbers alone is weak evidence of broader understanding. Mark only the specific demonstrated objective as understood, citing the answer/probe; keep remaining objectives open. A follow-up may strengthen or revise an earlier assessment.

## Choose a diagnostic check

Compare a proposed check with earlier recorded questions and learner answers, including earlier parts that teach the same rule. Skip an example already asked and reuse its evidence. A change of registers, names, numbers, or opcode is a duplicate when the learner must supply the same reasoning. For example, after identifying the destination and two sources in `sub $t0, $t1, $t2`, identifying them again in `add $t3, $t4, $t5` repeats the operand-position check. If only the opcode remains unresolved, address that gap alone; move on when cumulative evidence supports it.

Before recording a check, identify the unresolved concept and what the answer would reveal about it. Use the learner's prior answers and stated experience to set the level. If their evidence already meets the objective, continue to the next objective.

For `topic_recordQuestion`, supply `check` with the existing `goalIndex` and `criterionIndex`, both zero-based. State the `reasoningTask`, `missingEvidence`, and `expectedEvidence`. Describe the reasoning independently of names and numbers. Use recorded criterion assessments to credit earlier answers. The selected example serves the criterion; its incidental details do not add criteria. Follow [Feedback and deliberate](FEEDBACK_AND_DELIBERATE.md) when the learner answers or a follow-up is blocked.

Ask for one inference, prediction, explanation of a consequence, or decision within the taught scope. The learner must apply the explanation to answer. If they could answer by copying or paraphrasing the preceding explanation, replace the question. Adding "why" to a stated conclusion or changing names and numbers does not create a reasoning task. Keep the setup self-contained and teach the prerequisites before asking.

For example, after explaining that a browser attaches an eligible session cookie, asking who supplies the cookie tests repetition. If the learner has also learned that CORS controls response access, ask: "Assume cookie rules allow the session cookie on this form submission. The shop relies only on CORS to protect address changes. What happens if the attacker submits the form and never reads the response?" This tests how the mechanisms interact without requiring untaught cookie-policy details.

Before asking, privately work out the answer and identify the reasoning step the learner must supply. Compare it against the entire visible teaching reply, question setup, tables, diagrams, and options. Supply the facts needed to reason, while leaving the decisive application unresolved. A question that names the correct method and asks the learner to restate its purpose fails this check. After showing a solution, use a different in-scope application or credit sufficient existing evidence.

For example, after teaching Task, Pass, Wait, and Succeed, ask the learner to repair a workflow that reads stock once, waits, then ships using the old count. Give its concrete sequence and ask where the repair belongs and why. This combines taught behavior into a diagnosis without requiring Choice syntax, retries, or other later material. By contrast, explaining that an Email Task sends mail and then asking what it does that Succeed does not supplies the answer.

Calibrate against prior evidence: quick practice should require an independent application, not merely identify a term. Use a meaningful constraint or failure case to increase challenge within the taught concepts. Keep the setup unambiguous and the task focused; unfamiliar terminology and extra subquestions do not increase reasoning quality.

For a follow-up, identify the conceptual uncertainty left by the learner's answer. Correct an incidental wording error briefly and continue when the objective is supported. If independent reasoning remains unproven after a correction, use one different application of that specific concept. Rephrasing the supplied answer adds no evidence. When the learner points out that the answer was already given, acknowledge it and continue from existing evidence without another check in that reply.
