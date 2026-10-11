# Questions and feedback

## Choose source-based practice

Resume any active check before selecting another. Otherwise start with the current source example or exercise and the learner's actual difficulty. Use cached relevant pages and the existing check entries. Preserve the question's data and constraints; for labs, preserve its environment and observable result. A worked source example may be discussed or traced with the learner, but seeing its solution is not independent evidence of mastery.

For lecture slides and textbook exposition, first explain the coherent section using [TUTOR_EXPLANATION.md](TUTOR_EXPLANATION.md); then decide whether a Check would help. Default to the Feynman explanation below, grounded in the taught section. A supplied exercise can support appropriate practice but need not replace that Check. A Check is optional and does not replace teaching. For labs, tutorial exercises, past papers, and explicit practice mode, let the learner attempt the problem before giving its solution. For a Test or requested transfer practice, follow [TUTOR_TESTS.md](TUTOR_TESTS.md): evaluate unused asset questions first, search online only if none are viable, and author a question only if no viable sourced question is available. Label external, adapted, and tutor-authored practice distinctly. A conceptual Check can be tutor-authored directly from the taught section; it does not require the Test sourcing workflow.

## Default Check: explain current understanding

Use the Feynman technique: ask the learner to explain what they already understand in their own words, as if teaching someone new to the concept. Name a bounded concept or coherent section rather than asking for everything taught so far. For example: “In your own words, explain what you understand about events versus current entity state, as if teaching someone new to the idea.” An example or sketch can support their explanation when useful.

Let the learner choose their framing and say where they are unsure. An accurate explanation of already-taught material is useful evidence for this Check; it need not solve a new scenario or demonstrate transfer. Assess the meaning and relevant relationships they express, rather than demanding jargon, polished prose, a long answer, or the tutor's wording. A list of labels or verbatim repetition may leave understanding unassessed; use one focused follow-up only when it would resolve a material uncertainty.

After an attempt, identify what is sound, correct the specific misconception if any, and re-explain a difficult link using the current example. Ask the learner to explain the repaired link when it remains unresolved. Once the Check is resolved, follow the normal feedback-to-action rule. If the learner says they do not understand, teach the difficult part directly before asking them to explain again.

## Other Check formats when useful

Use a bounded comparison, trace, diagnosis, prediction, or repair when it addresses a specific gap or the learner's requested practice. For software concepts, constructing or repairing pseudocode—including schemas with rationale comments—can address a concrete design gap or advance the POC. Use [PSEUDOCODE_POC.md](PSEUDOCODE_POC.md) for appropriateness, semantic evaluation, and continuity with an existing sketch. These are alternatives to the default explanation Check, not requirements on every section.

Use the source's actual example when suitable; label a changed scenario as a tutor-authored variation and show all needed content. Stay within taught prerequisites. A focused missing-part clarification or assisted retry can remain simple. Reserve claims of transfer for a Test that meets [TUTOR_TESTS.md](TUTOR_TESTS.md).

Match the scope and difficulty to the learner's demonstrated understanding. Verify the key before asking; for an explanation Check, use the essential concepts and relationships as acceptance criteria, allowing valid wording and examples. Give the check a stable ID, persist its exact question and full context in `topic.md`, and save the key plus active-check pointer in the workpad before ending the asking turn. This applies to brief checks, probes, and follow-up questions as well as longer exercises. A targeted retry can reuse an example to repair a gap, but describe it as assisted practice. Avoid a stream of near-identical probes when the learner needs an explanation.

Before an attempt, follow SKILL.md’s pending-answer boundary, including on resume/status requests and retries. A request for orientation is not an attempt to evaluate.

## Evaluate proportionately

For an elementary trace, calculation, or definition, use the saved question and checked key and respond directly. For example, an array `{2,4,6}` with each element incremented once yields `{3,5,7}`; that does not need PDF rereading, reviewers, or a compiler run. Inspect original source pages only when the saved context cannot settle a material issue.

A short sanity check is enough when the learner's answer, stated reasoning, and checked key agree. Reopen the key when a mismatch, contradiction, or learner objection supplies a concrete reason; correct it and record qualifying deliberation if the tutor made an error.

Give the result and the one explanation or correction that matters. If the learner supplies a correct result without reasoning, acknowledge it; ask for reasoning only where it will clarify an unresolved concept. If they say “I don't get it,” show a smaller step in the same source example rather than issuing another assessment immediately.

For an unclear result, recheck the disputed step using the source or an appropriate calculation/tool. Use a single focused reviewer only if consequential uncertainty remains or independent review was explicitly requested. Supply the question, relevant source, both proposed answers if relevant, and the precise uncertainty. Resolve that uncertainty, then stop. A disagreement alone does not require an automatic judge; inspect the learner's objection first and correct yourself when warranted.

For an unresolved substantive reasoning gap or requested mastery assessment, use [WHAT_IS_UNDERSTANDING.md](WHAT_IS_UNDERSTANDING.md). A correct result with a false justification leaves a conceptual gap; a slip with sound reasoning needs a local correction. Record the specific demonstrated strength or difficulty, not a blanket mastery verdict.

For multipart answers, distinguish correct completed parts from material omissions. Ask only for the missing part in a separate final **Remaining question** paragraph, making it self-contained. Keep that follow-up active in the handoff. Once resolved, follow SKILL.md's feedback-to-action rule: begin the next explanation or offer the meaningful checkpoint choice. Do not leave the learner with a verdict alone or a follow-up buried inside a feedback bullet.

## Record every check

Store each check under its subject in `topic.md` with a stable heading/anchor, the exact prompt, necessary code/data/diagrams, and attribution using [FILE_STRUCTURE.md](FILE_STRUCTURE.md). Preserve the learner's actual answer under **Your answer** when it arrives, including their code and working. Keep a later corrected attempt distinct from the original. Do not replace the answer with a tutor-written summary.

For solution images/files, copy the original into `assets/answers/<check-id>/`, retain its extension, and link it under that answer. Embed viewable images as well as preserving the original file link. Use a distinct filename for a different attachment instead of overwriting it. Reference readable extracted text or a short description only as an aid, not as a replacement for the submitted asset. If copying or reading fails, record that limitation and keep any stable original link; do not claim it was attached or inspected successfully.

Add **Deliberation** if and only if at least one of these holds:

- The learner's answer or reasoning is wrong.
- The tutor's answer or reasoning is wrong.
- There is contention about an answer or its assessment.

Then state the precise disputed/error point, correction, and concise supporting reasoning; preserve the relevant original claim. Update that block when the issue is resolved. A correct, uncontested answer gets its question and answer only—no deliberation heading, “no errors” block, or routine reasoning recap. Missing reasoning, an unanswered check, or a request for clarification alone does not trigger deliberation. Broader learning takeaways may be consolidated at section boundaries.

Keep active-check status and unrevealed keys in the workpad. Topic entries remain a compact exercise record within revision notes, not a record of all surrounding chat. Use the compact `save` operation in [FAST_IO.md](FAST_IO.md) to record answers and changed handoff fields without reproducing existing text.
