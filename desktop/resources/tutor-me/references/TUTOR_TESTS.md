# Tests: apply and combine concepts

Use this workflow when the learner selects or explicitly requests a Test. A Test should require deciding how to apply concepts, explaining a mechanism, diagnosing a fault, comparing approaches, or constructing a solution under constraints. A factual recall prompt, repetition of a worked example, or the same question with renamed variables or changed numbers does not establish transfer. Keep a quick Test small: usually one or two substantive questions, presented one at a time, with reasoning requested. Do not reveal the solution before an attempt unless the learner asks.

Choose the response format to fit what is being assessed:

- **Open-ended questions** for explaining a mechanism in a new situation, reasoning about tradeoffs, or defending a design.
- **Problem solving** for applying a method, calculating, tracing, diagnosing, or deriving a result.
- **Pseudocode or schema construction** for software behaviour, data representation, or update flows; rationale can be supplied as comments.

Combine formats only when the objective needs it. The default Check asks the learner to explain current understanding; a Test goes further by asking them to apply it to a fresh question. Open-ended does not mean recall-only, and a software Test need not require code.

For software construction, accept pseudocode or schema sketches with rationale comments unless syntax is the objective. Follow [PSEUDOCODE_POC.md](PSEUDOCODE_POC.md): an existing POC can supply the setting, but a Test still needs a fresh reasoning demand. Extending a demonstrated design is a Check or assisted practice unless the extension meets the transfer rule. Preserve the sourcing order below.

## Select and evaluate questions

Use the covered notes and actual learner evidence to identify the target concepts and suitable prerequisites. A directory entry or a displayed solution is not proof of understanding. Then follow this order:

1. **Assets first.** Inspect relevant tutorials, labs, textbook exercises, past papers, and slide questions using existing caches/indexes. Compare candidate question IDs, source locations, prompt content, and solution structure with prior Checks, Tests, worked examples, and learner attempts in the notes. Select a genuinely unused, viable question; merely being present in an asset does not make it suitable. A previously solved or explained item is revision, not a fresh Test. If prior exposure cannot be established, do not claim the item is unseen; prefer a clearly fresh alternative.
2. **Online next, if no asset question is viable.** Run a focused search for exercises on the target concepts. Inspect the actual question and source, preferring original educational sources. Evaluate novelty, level, completeness, and the answer before using it; a search snippet or matching title is insufficient. Stop once enough viable questions are found for this quick Test. If search is unavailable or no suitable question is accessible after a focused search, state that briefly and proceed to authoring.
3. **Author only when no viable sourced question is available.** Create a fresh application problem grounded in the taught concepts. Label it tutor-authored; do not attribute it to the slides. When scaling difficulty, combine the target concept with other concepts supported by prior learner answers, and add meaningful dependencies or constraints rather than cosmetic changes or obscure trivia. Do not introduce an untaught prerequisite as a hidden test of understanding.

Before presenting any candidate, solve/check it and confirm that it has sufficient data, clear assumptions, a defensible answer or acceptance criteria, and a meaningful reasoning demand. For open-ended problems, allow valid alternative approaches. For code, avoid accidental undefined behaviour unless identifying it is the intended, taught objective. Reject questions whose answers were just supplied, that duplicate the same reasoning path without meaningful transfer, or that require unsupported prerequisites. This suitability evaluation is concise preparation, not a user-facing report or mandatory independent-review ceremony.

Display the complete relevant question, code, data, or image in chat and identify its source. Label an adaptation explicitly. Keep answer keys and marking criteria in the workpad until the learner has attempted it; showing the question's assets does not require exposing a solution printed beside it.

## Evaluate the attempt

Evaluate the actual answer AND reasoning against the target concepts and checked criteria. Give a clear verdict, identify the decisive correct or incorrect step, and explain any needed correction. A correct result with absent reasoning is not evidence of the full reasoning process; ask one targeted justification when it materially determines the Test outcome. Recognise valid alternative solutions. Distinguish independent success from an answer reached with hints, and distinguish a local slip from a conceptual gap using the evidence.

Use the normal recording rules: preserve the exact question, learner answer, and submitted assets; add deliberation only for a wrong learner/tutor answer or contention. Record a compact outcome and the concepts demonstrated or needing review, without adding a routine reasoning recap to correct answers. For an incomplete multipart answer, use one clearly separated, self-contained remaining question; do not declare the Test complete or mix in a competing menu. When the final Test item or focused retry is resolved, summarise what the evidence supports and offer the meaningful next choice: review a specific gap, take further practice if useful, or continue to the saved lesson location. Do not launch another Test automatically.

## Persist for the next thread

Give each Test and question stable IDs, for example `T3-01-Q1`. Store each question and answer under its topic heading with its provenance (asset filename and page/question ID, original URL, or tutor-authored), target concepts, and eventual outcome. This record is also the history for avoiding repeats; look up relevant concepts and source IDs rather than rescanning all materials after every reply.

Use the existing `Active check` workpad field to point to the active Test question, with `Phase: awaiting_answer`. Keep the Test scope, checked key/criteria, remaining question IDs if already selected, and return-to-lesson section in the workpad. Persist an asked question before ending that turn and the actual answer/assessment before marking it complete. Resume a pending Test question before generating another; preserve an unresolved Test-or-continue choice across threads. Use the normal combined save and cached sources during evaluation; source selection/search belongs to Test preparation, not each answer turn.
