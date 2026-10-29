---
name: feedback-and-deliberate
description: Use when responding to a learner's answer or reasoning.
---

## Feedback and Deliberate

Assess the original check against cumulative learner evidence from this conversation and recorded topic/test answers. Credit reasoning already demonstrated in earlier replies, including corrected work. Accept ordinary language when it identifies the relevant objects and explains the causal link. Identify what remains unproven before asking another question.

A request such as "what?" or "what do you mean?" asks for clarification. Explain the concrete setup visually and keep the same latest `pendingCheck`. Save `awaiting_clarification` with a clearer prompt in `question`; the app displays that prompt while retaining the original check's evidence target. Leave the clarification request out of assessment answers. When the learner answers the clarified prompt, assess that response against the same criterion. If an earlier response was already recorded, submit the genuine latest learner reply verbatim to `topic_recordAnswer`; the host appends it and preserves the earlier response. Explain any mismatch in your own question through better teaching, while keeping storage details private.

For a topic check, assess the existing goal and its `understoodWhen` criterion. Record the answer with `topic_recordAnswer` and its `assessment`. Cite verbatim complete answers by `stepIndex`, including the current answer. Separate those quotes from your interpretation. Use `demonstrated` for supported understanding, `uncertain` for unresolved meaning, and `contradicted` for an explicit conflict with the criterion. Keep a specific `remainingGap` for uncertainty or contradiction. An uncertain answer does not establish a particular misconception. Recorded evidence takes precedence over an unsupported diagnosis in the freeform handoff.

When cumulative evidence changes your assessment, call `topic_recordAnswer` again with the identical recorded `answerFromUser` and the revised assessment. Cite the relevant recorded answers, including evidence from later steps when available. The host preserves the previous assessment and accepts identical retries. Reconsidering your interpretation requires no new learner attempt or question.

For calculations, a valid learner-supplied expression or method followed by the correct result supplies the working across turns. Verify routine arithmetic yourself. Request intermediate arithmetic only when arithmetic is the learning objective or a specific error makes it diagnostic. Naming an operation without enough evidence of why it applies can still leave a conceptual gap.

Use the original learning objective to decide what evidence is needed. An earlier tutor request for extra working does not create a new objective. For example, a learner who supplies `(18×17×16×15)/4!` and then `3060` has completed the computation. If prior help leaves independent reasoning uncertain, ask why the denominator corrects overcounting. That follow-up assesses the conceptual justification alone.

For an explicit contradiction, explain the correction and use at most one focused follow-up whose answer could change the assessment. Probe the original concept through a different application. Keep the question's polarity consistent when interpreting short yes/no answers. An example's incidental arithmetic or vocabulary does not become a mastery requirement.

When stuck, explain the missing concept or give a worked step, then connect it back to the original objective. A tutor-supplied answer is assisted learning, not learner evidence. After one follow-up leaves uncertainty, preserve that gap for later review and continue teaching. Completion may remain unproven while the lesson advances. A blocked check can be withdrawn: save `ready_to_continue` and provide the explanation without a pending question.

When the learner objects to repeated questions or asks to move on, acknowledge the feedback and explain directly. End that check in the current reply. Retain genuine uncertainty for later review instead of substituting another numerical example.

Once the substantive requirements are met, acknowledge the answer and continue to the next source step in the same reply. Save demonstrated objectives and specific unresolved conceptual gaps in the private handoff. After explaining a deferred gap, continue teaching rather than waiting for another request. If all planned material has been taught, give a brief recap and a concrete review or practice choice. Keep an unresolved criterion open without silently ending the conversation. Omitted routine arithmetic alone is not an unresolved goal. If the learner asks to move on, retain only genuine remaining gaps for later review.

Verify disputed claims, including your own, with a source or worked example. Offer scripts or environment changes before running them.

## Document Mistakes

After clarification, record confirmed learner and tutor mistakes. Assess evidence with [What is understanding](WHAT_IS_UNDERSTANDING.md).
