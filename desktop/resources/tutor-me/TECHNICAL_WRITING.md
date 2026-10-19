# Technical writing

## Shape

- Use short, direct bullets for instructions.
- Use numbered steps for sequences. Preserve their order and dependencies.
- Preserve examples, including code, values, and notation.
- Keep one idea per point. Group related points.
- Use short headings with clear boundaries.
- Explain reasoning in small, justified steps. Brevity must preserve meaning.
- Vary sentence length when it helps. Keep necessary articles and verbs.
- Use [UNSLOP.md](UNSLOP.md) to edit wording and remove filler.

## Choose the document's mode

- Tutorial: learning by doing. State what the learner builds and the expected result at each step.
- How-to: steps for an existing task. Link background separately.
- Reference: facts, options, limits, and errors. Follow the subject's structure.
- Explanation: one bounded why question, with context and trade-offs.
- Keep each document in one mode. Split and link different modes.

Examples:

- Tutorial: "First, do x. Now, do y."
- How-to: "If you want x, do y." Title: "How to calibrate the radar array", rather than "Radar array calibration".
- Explanation titles should read naturally after "About...".

## Write clear sentences

- Address the reader as "you" in the present tense.
- Use commands for instructions. Put the condition first: "To delete the document, click Delete."
- Name the actor, source, symbol, or operation.
- Use actual code symbols, file names, flags, and commands.
- Keep source notation and one consistent name per concept.
- Explain unfamiliar terms. State uncertainty precisely.
- Make pronouns point to one clear noun.
- Put "only" and "not" next to the words they change.
- Keep conjunctions and articles that prevent ambiguity.
- Prefer instructions under 20 words and other sentences under 25. Keep longer sentences when clearer.
- Use sentence case headings, code font for symbols, and bold for UI elements.
- Link with descriptive text. Keep one h1 and consecutive heading levels.

Examples:

| Instead of | Write |
|---|---|
| "schema changes can cause issues" | "a column rename fails the build" |
| "queries are validated" | "the compiler validates queries" |
| "should be done" | "Click Submit." |
| An instruction before its condition | "If hot oil touches your skin, injuries can occur." |
| "Remove backup file" | "Remove the backup file" |
| "start" and "initiate" for one action | "start" consistently |
| "the component must be installed" | "Install the component" |
| "Modes" | "Pick the mode first" |
| "only fails on growth" | "fails only on growth", when growth is the sole failure condition |
| "the proto import budget check script" | "the script that checks the proto-import budget" |
| "Phase 1 moves the converters and Phase 2 the runtime" | "Phase 1 moves the converters and Phase 2 moves the runtime" |
| Dropping "that" | "Ensure that the switch is off" |
| "the client and host" | "the client and the host", for two things |
| Ambiguous conjunctions | "Both...and", "either...or", or "if...then" |
| "(s)" plurals | Write the intended singular or plural |
| "a/b" or "and/or" | "a, b, or both" |
| "the gate", "the ratchet", and "the budget check" for one concept | One consistent name |

## Worked edit

Before:

> Configuration of the proto import ratchet budget script parameters is performed via budget.json. Note that it's important to remember that running with --write, which updates the committed budget to reflect the current count, should only be done when lowering it. If exceeded, CI fails.

After:

> `budget.mjs` reads the committed budget from `budget.json` and counts the files that import protos. If the count exceeds the budget, CI fails. Run `budget.mjs --write` only to lower the budget.
