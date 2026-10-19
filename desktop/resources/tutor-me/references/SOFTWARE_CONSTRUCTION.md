# Software construction

Use when a learner-authored algorithm, data model, or flow demonstrates a lesson goal.

## Ask for a sketch

- Teach the prerequisites first.
- Keep one bounded construction question active.
- State required behavior, inputs, and boundary conditions.
- Reuse a suitable source example or the learner's current sketch.
- Show the context. Leave the assessed design decisions to the learner.
- Accept rationale in comments. Ask for extra prose only for an unresolved decision.
- Use conceptual questions when construction adds no useful evidence.
- Follow the question guide's sourcing rules for independent tests.

### Construction examples

- **Data structures:** “Sketch a singly linked list with `insert(number)`, `peek()`, `get(index)`, and `delete(index)`. Here `insert` prepends, `peek` returns the head value, and indices start at zero. Define the node/list state and explain your empty-list and invalid-index behaviour. Pseudocode in your own style is fine.” Use a smaller subset when the full interface exceeds the current section.
- **Schemas:** After teaching event/entity separation and update rules, ask the learner to define the event and entity schemas for the existing application example, with comments explaining keys, field placement, and why each update rule belongs there. Include the application requirements directly in the prompt. Request only decisions that have been taught.
- **A flow:** Once the relevant stages have been explained, ask for the small function connecting the already-designed input records to stored state, or for a repair to a specific missing transition.

## Evaluate behavior

- Accept informal types, mixed prose/code, and omitted boilerplate when intent is clear.
- Require exact syntax or API usage only when it is an objective. Say so in the prompt.
- Check representation, transitions, boundary cases, and the stated contract.
- Assess complexity only when required by the goal.
- Accept valid alternative designs.
- A placeholder such as "update correctly" leaves the mechanism unanswered.
- Dereferencing an optional list head on an empty list, or losing existing nodes during insertion, is a logic error.
- Clarify ambiguous notation with one focused question.
- Explain a logic error and let the learner repair it. Preserve the original attempt.

## Grow the sketch

- Keep one running example when suitable. Retain sound learner names and decisions.
- Add or repair one missing piece at each relevant checkpoint: representation, operation/update rule, then a connecting flow.
- Keep scope within the agreed lesson.
- Reuse an independent test contribution only when it fits the design.
- Recover actual sketches from structured question history. Label new scaffolding honestly.
- If no sketch exists, ask for one missing piece, such as schemas with rationale comments, from the saved lesson context.
- A missing sketch does not require restarting a confirmed lesson or replacing a pending question.
- Use the normal question records and continuation rules.

## Finish

- Check that required representation and operations connect coherently.
- Account for relevant boundary paths. Resolve material placeholders and known errors.
- Judge learner reasoning, not components supplied by the tutor.
- For a remaining gap, show the relevant sketch and ask one bounded repair question. Examples: a schema relationship, update step, or boundary path.
- Once complete, show the consolidated sketch and offer implementation.
- Save the proposed scope as `awaiting_choice` in the private handoff.
- Implement only after the learner chooses it. Clarify language or target if needed.
- Honour a pause, skip, or choice to stop.
