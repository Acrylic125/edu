# Software construction and a mini POC

Use this guidance for software-driven learning where constructing behaviour or a data model demonstrates understanding: algorithms, data structures, application schemas, or system flows. Build a small learner-authored proof of concept (POC) from the relevant Checks and Tests over the conversation. Keep its scope within the agreed lesson; a paper discussion need not become a reproduction of the full system.

## Choose an appropriate construction question

Software Checks follow the Feynman default in [TUTOR_QUESTIONS_AND_DELIBERATE.md](TUTOR_QUESTIONS_AND_DELIBERATE.md): invite an explanation of current understanding. Ask for a sketch when a concrete design gap or a POC contribution requires deciding how data is represented, how operations change state, or how components connect. A Test may use open-ended reasoning, problem solving, or construction according to its objective; neither every software Check nor every Test needs pseudocode. Other subjects retain their suitable assessment formats.

Teach the relevant concepts first under the normal lesson rules. At a useful checkpoint, ask for one bounded construction task that requires applying them. Reuse a suitable source example or the learner's existing sketch and show the necessary context. State the required behaviour and inputs, not a solution disguised as a scaffold. Ask only for components supported by covered prerequisites.

For example:

- **Data structures:** “Sketch a singly linked list with `insert(number)`, `peek()`, `get(index)`, and `delete(index)`. Here `insert` prepends, `peek` returns the head value, and indices start at zero. Define the node/list state and explain your empty-list and invalid-index behaviour. Pseudocode in your own style is fine.” Use a smaller subset when the full interface exceeds the current section.
- **Schemas:** After teaching event/entity separation and update rules, ask the learner to define the event and entity schemas for the existing application example, with comments explaining keys, field placement, and why each update rule belongs there. Include the application requirements directly in the prompt. Request only decisions that have been taught.
- **A flow:** Once the relevant stages have been explained, ask for the small function connecting the already-designed input records to stored state, or for a repair to a specific missing transition.

The learner can express rationale inline as comments; request further prose only for a material unresolved decision. Keep one coherent question active, with the normal stable ID, exact prompt, and unrevealed checked criteria.

## Accept the learner's notation; evaluate the behaviour

Accept informal types, optional fields, mixed code/prose, omitted boilerplate, and the learner's naming and layout when the intended behaviour is clear. A schematic configuration can be sufficient without exact JSON, SQL, framework, or language syntax. When syntax itself is the objective, including exact API usage, require the relevant syntax and state that requirement in the prompt.

Evaluate the same semantics as an implementation: representation, state transitions, relevant boundary cases, and consistency with the stated contract. Assess complexity or other constraints when they are part of the objective. Rationale comments can supply the needed reasoning. Accept valid alternative designs; the checked key is not a mandatory spelling or layout.

High-level detail is enough only when the mechanism is expressed. A placeholder such as “update correctly” leaves the assessed operation unanswered. Distinguish harmless shorthand from a real logic error: for example, dereferencing an optional list head on the empty-list path, or losing existing nodes during insertion, changes behaviour regardless of syntax. If notation is ambiguous, ask one focused clarification; if behaviour is wrong, explain the specific error and let the learner repair it. Preserve their original attempt and record the correction under the normal rules.

## Grow the POC through the conversation

Use one suitable running example when available, keeping the learner's names and decisions where they remain sound. Each relevant question can add or repair a small part: data representation, an operation or update rule, then a flow showing how those parts work together. Conceptual questions can still intervene. Aim for a coherent sketch the learner can explain and later implement, rather than unrelated fragments or a full project assigned at once.

A Check can extend the taught example or current sketch. A Test follows the normal sourcing and novelty rules in [TUTOR_TESTS.md](TUTOR_TESTS.md). Reusing a setting is acceptable when a new constraint or problem creates meaningful transfer; merely reproducing a shown schema or completing the same worked solution is revision or assisted practice. Feed an evaluated Test contribution back into the POC when it fits; keep a separate transfer scenario separate when merging it would distort the design.

When a discussion is already deep but has no learner-authored sketch, start from the concepts and examples actually available in the saved notes. Ask the learner to construct one missing piece—such as their own schemas with rationale comments—at the next appropriate checkpoint. There is no need to restart a confirmed lesson or create a new plan for this bounded Check. Keep an existing pending question active unless the learner explicitly changes or skips it.

## Persist and resume

Store exact construction prompts and learner-authored sketches as structured question/answer steps through recordQuestion and recordAnswer. Preserve original attempts. The topic summary may explain the conceptual design and worked examples, but individual assessment history belongs in topic.state.json. Keep unrevealed criteria and temporary preparation in the private chat handoff.

On a fresh thread, use whereAmI and whatIsNext under SKILL.md's continuation rules. Ask the learner to select among competing continuations before activating a part. Read relevant question history with getQuestions when recovering an explicitly requested sketch or deduplicating a new prompt. Show the necessary definitions and code in the response. Label new scaffolding honestly; never invent earlier learner work.

## Finish with gaps or an implementation choice

At the endpoint of the agreed software scope, inspect the accumulated sketch against its stated behaviour. Completion means its required representation and operations connect coherently, the relevant boundary paths are accounted for, and no material assessed behaviour remains a placeholder or known error. Judge the learner's demonstrated reasoning, not just whether the tutor has displayed all the components. Boilerplate and language-specific syntax are not gaps unless they were objectives.

If a material gap remains, show the current relevant sketch with that gap and ask the learner to fill it in one bounded Check. Preserve earlier correct portions; a long conversation may need only a missing schema relationship, update step, or boundary path. Evaluate the answer and revisit any remaining material gap before declaring the POC complete.

When the POC is complete, show the consolidated sketch and ask whether the learner wants to implement it. Save that choice as `awaiting_choice` in the private chat handoff with the proposed implementation scope. Begin implementation only when the learner chooses it, clarifying the language or target if necessary. Honour an explicit pause, skip, or choice to end without implementation.
