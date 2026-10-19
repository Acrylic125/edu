# Explain from the source

## Teach a section

- Read the current source section before teaching.
- Group reveal slides and repeated material into one coherent section.
- State the main idea and purpose.
- Explain unfamiliar terms, notation, assumptions, and relationships.
- Walk through the source's actual example with its names and values.
- Justify each meaningful transition. Use roughly one or two concise lines per step.
- Connect to taught concepts and state relevant source limitations.
- Explain worked examples before checking understanding.
- Let the learner attempt unsolved exercises first, unless they request a walkthrough.
- Follow an explicit quiz-only or practice-only request.

## Show the material

Apply SKILL.md's pending-answer boundary first.

- Show every specific reference discussed in the same response, including earlier examples and learner assets.
- Images and slides: embed the original or a readable crop with necessary labels, axes, and legends.
- Text: show a relevant excerpt with context.
- Equations: render the expression and define its symbols.
- Tables: include relevant rows, headers, and units.
- Code: include the complete relevant loop, branch, or function with its inputs and declarations.
- Other formats: provide a visible excerpt or preview.
- Keep source values and control flow. Label adaptations and reconstructions.
- Reuse cached text and renders. Read only the needed region.
- If access or quotation limits prevent display, state the limitation and provide a labelled alternative.
- A link or text description does not replace an available source visual.
- Put citations after the explanation using [FILE_STRUCTURE.md](FILE_STRUCTURE.md).

### Code example

```c
#define N 10
int source[N] = {10, 20, 30, 40, 50};
int dest[N];
int i;

for (i = 0; i < N; i++) {
    dest[i] = source[i];
}
```

- `i` runs from 0 through 9. Each iteration copies one integer to the corresponding destination element.
- Showing only `dest[i] = source[i]` hides the loop bounds and progression.
- For another lesson, use its actual source code.

## Resolve confusion

- Identify the difficult transition and explain it concretely before another probe.
- For code, substitute current values and show the state change.
- For diagrams and calculations, show the relevant relationship.
- Use the learner's response to distinguish unclear teaching from a prerequisite gap.
- If uncertain, make one focused clarification.
- Review a missing prerequisite briefly, then return to the section.
- A directory heading does not establish prior knowledge.
- Apply teaching feedback at its stated scope.

## Inspect attached images

- Inspect pixels even when OCR is empty.
- Explain recognizable text, notation, diagrams, or code in context.
- Mark uncertain symbols or words. Example: "I read this as x approaching a from the right."
- Ask only about ambiguities that change the explanation.
- If inaccessible or unreadable, state the specific limitation.
