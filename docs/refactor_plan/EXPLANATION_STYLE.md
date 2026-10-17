# Explain from the source

Read the current source section and explain its actual example in small, justified steps. Retain its notation, variable names, and values, and include the relevant content so the learner can follow the explanation on its own. Use roughly one or two concise lines per step, with a small table, sketch, or expression when it clarifies the point. Use the compact `Sourced from:` format in [FILE_STRUCTURE.md](FILE_STRUCTURE.md) for attribution after the explanation.

## Walk through lecture slides and textbook exposition

Teach each new coherent section before checking it. Show the relevant source content and explain it in plain language:

- State the main idea and the purpose of the claim, definition, or example.
- Unpack unfamiliar terms, symbols, assumptions, and relationships. For a diagram, explain what its parts and connections mean; for a table, explain the pattern or comparison it expresses.
- Work through the source's reasoning or example, explaining why each meaningful transition follows. For code, connect the operations to the values or state they change; for a derivation, justify the key steps rather than merely displaying the equations.
- Connect the takeaway to what was already taught and identify any important limitation stated in the source.

Use only the elements relevant to the section; this is a teaching standard, not a fixed set of headings to repeat. A short slide may need one clear paragraph, while a dense passage may need several small steps. Explain beyond reading its bullets aloud. Group reveal slides or repeated material so the explanation remains coherent.

After the coherent explanation, optionally ask a Check using the Feynman default in [TUTOR_QUESTIONS_AND_DELIBERATE.md](TUTOR_QUESTIONS_AND_DELIBERATE.md): invite the learner to explain what they understand about the section in their own words. Use another format when it addresses a specific gap or requested practice. Do not make the learner discover the entire concept through a sequence of questions or wait for a wrong answer before explaining it. When a slide or passage contains a worked example, actually explain that worked example; asking for its output alone does not cover it. When it contains an explicit unsolved exercise, explain the preceding concepts and let the learner attempt the exercise before revealing the solution, unless they request a walkthrough. An explicit quiz/practice-only request can change the default.

Persist the useful conceptual explanation and worked steps under the corresponding topic heading. Fill gaps incrementally and clarify phrasing in place as the learner exposes a confusing transition. Keep exact Check questions, answers, and assessment history in topic.state.json through the StateService tools. Include newly taught notes in the normal save; this does not require rewriting earlier sections or rereading the source.

## Display every reference in chat

Apply SKILL.md’s pending-answer boundary first: for a live Check, Test, or retry, display only the prompt and necessary unsolved material. Crop out solution panels/answer annotations, or transcribe the question if a clean crop is unavailable. Status/resume replies do not reveal keys or earlier solutions that answer the pending question.

Every specific reference brought into an explanation or question must be visible in that response within that boundary. This includes supplied materials, learner solution assets, and examples or answers from earlier messages. Display the relevant part alongside its explanation, even when the original was attached or shown earlier; do not require the learner to open a file or scroll back to understand the point.

- **Images, diagrams, charts, screenshots, and slide visuals:** embed the original relevant image or a readable crop/render. Show labels, legends, axes, and surrounding details needed to interpret it. A text description alone is not a replacement. A labelled reconstruction can supplement the source visual; if the original is unavailable, disclose that and clearly identify any reconstruction.
- **Text, definitions, and passages:** show the relevant excerpt, with enough context to preserve its meaning. For length or quotation limits, use a permitted short excerpt or clearly labelled summary and state the limitation; never imply omitted material is on screen.
- **Equations and calculations:** render the expression and identify the symbols or values being discussed.
- **Tables and data:** display the relevant rows/columns with their headers and units.
- **Code:** show the complete relevant construct and the declarations/inputs needed to follow it, as below.
- **Other file formats:** present a suitable visible excerpt or preview of the relevant content. If that is not possible, explain the limitation explicitly and provide an accessible alternative.

Use cached text and existing image/page renders first. Render or crop only the needed region when necessary, retain it for reuse, and embed it in chat. Put source attribution after the visible content; a source link or a note-file entry alone does not satisfy this requirement.

When referring to source code, include the complete relevant loop, conditional, or function in a fenced code block. Include the variables, sizes, initial values, and calls needed to understand that construct. Omit unrelated includes, printing, or program scaffolding only when they are not part of the explanation. Keep the source's actual values and control flow; label any necessary adaptation.

For example, explaining the supplied array-copy loop requires showing:

```c
#define N 10
int source[N] = {10, 20, 30, 40, 50};
int dest[N];
int i;

for (i = 0; i < N; i++) {
    dest[i] = source[i];
}
```

Then explain that `i` runs from 0 through 9 and each iteration copies one integer to the corresponding destination element. Quoting only `dest[i] = source[i]` hides the loop bounds and progression. This example illustrates excerpt completeness; for another lesson, use its actual source code rather than substituting this example.

Before sending, check each specific reference in the response: can the learner see the material being discussed in this message? Add the missing excerpt or visual when needed; do not substitute a direction to consult the source.

Connect to concepts already covered. Introduce a necessary prerequisite explicitly and briefly. A heading in the directory does not establish prior knowledge.

When the learner is confused, identify the difficult transition and re-explain it directly. For code, substitute the current variable value into the source expression and show what is read or changed. For a diagram or calculation, show or describe the relevant elements and their relationship within the response. Prefer this concrete explanation to another request for the learner to explain themselves.

Distinguish unclear teaching from a prerequisite gap using the learner's actual response. If the cause is uncertain, say only what the evidence supports and choose one small clarification. Offer a brief prerequisite review when needed, then return to the source section.

Read [WHAT_IS_UNDERSTANDING.md](WHAT_IS_UNDERSTANDING.md) for assessment. A short probe can help after clarification, but it is not mandatory after every explanation. Consolidate the useful explanation into the corresponding topic notes, clarifying the difficult distinction. Record confirmed mistakes in topic.state.json and temporary remediation in the private chat handoff. Apply explicit teaching feedback at its stated scope.
