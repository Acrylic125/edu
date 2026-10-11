# Current difficulty memory

Treat `Topic.mistakes`, if that name is used by an implementation, as the learner's current difficulties rather than a collection of historical wrong answers. Keep the original attempts and corrections in their existing topic records; those records are the evidence for the evolving assessment.

## Storage and identity

Use the existing workspace: current difficulties live beside their concept in `topic.md`; reusable tutor preferences live in `tutor-memory/behaviour.md`. Keep handoff state and pending keys in `agent.workpad.md`. This design does not require a new event database, search service, or external `LLM_MERGE` API.

In a shared implementation, scope a topic entity by learner identity and topic identity. Scope reusable tutor preferences by learner and tutor/skill identity as needed. Route an update using those known keys; semantic search is for finding relevant context, not guessing who owns a record.

A compact current entry has:

```text
difficultyId: stable within this learner/topic
concept: the specific skill or distinction
status: needs_explanation | unresolved | improving | resolved | contested
summary: current assessment, limited to observed evidence
evidence: links to the relevant attempts, corrections, or explicit statements
```

These fields can be represented as prose under a stable anchor. Create entries only when there is a supported learning need; preserve their IDs when wording changes. Keep tutor mistakes and disputes about the tutor's assessment in their own correction/deliberation records. A tutor error alone establishes no learner deficit.

## Evidence and status

| Evidence | State interpretation |
|---|---|
| Explicit difficulty understanding a concept | `needs_explanation`; describe the learning need without inventing a false belief |
| Incorrect learner claim or reasoning | `unresolved`; name the particular misconception |
| Repeated evidence of the same difficulty | Update that entry and its evidence links |
| Tutor supplies an explanation | Record the explanation; retain the learner's current assessment |
| Correct answer reached with hints or exposed solution | Record assisted performance; qualify any improvement accordingly |
| Independent success on a suitable fresh problem | Record the demonstrated improvement, limited to the assessed skill |
| Contrary evidence after improvement | Revise or reopen the specific difficulty |
| Disputed assessment | `contested` until the underlying claim is checked |

A clarification question alone may be ordinary learning, not evidence of a persistent difficulty. “I don't know” establishes no incorrect belief. Use explicit learning needs and actual attempts to decide whether a current entry is useful.

Use `resolved` only when evidence addresses the recorded difficulty at its stated scope; describe what was independently demonstrated. A correct result with an unassessed rationale, assistance, or one narrow example supports a narrower claim than general mastery. Pending questions remain pending regardless of changes to a difficulty summary.

Resolved entries can remain as concise records of improvement, but are no longer active remediation targets. A later recurrence can reopen the same entry with its new evidence.

## Merge update

After settling the teaching assessment:

1. Select the existing entry for the same concept and learner/topic, if any.
2. Combine its current assessment with the new relevant evidence. Preserve distinct misconceptions as distinct entries; match concepts rather than wording alone.
3. Revise the summary/status and add evidence links. Keep original question and answer wording intact in their historical records.
4. Persist only the changed entry and normal answer/handoff updates. Use the existing compact save, or a bounded exact-text `apply` revision when replacing an existing entry cannot be expressed by `save`.

`LLM_MERGE` names this semantic reconciliation in a schema-based implementation. The tutor can perform it in its existing response context; a separate inference call is optional. Completed checks need no second evaluation just to update memory. Unchanged evidence needs no state rewrite.

Example:

```text
Old entry:
  unresolved: Confuses event schemas with entity-property operator configuration.
  evidence: original incorrect attempt

New evidence:
  Independently places SUM on the entity property in one fresh example.

Merged entry:
  improving: Correct operator placement demonstrated in one independent example;
             broader understanding remains unassessed.
  evidence: original attempt + new independent attempt
```

## Retrieval and tutor feedback

Load the relevant current topic entries when resuming or choosing the next teaching step. Follow evidence links for ambiguity or historical questions. Retrieve across other topics only when useful. Primary and auxiliary search are optional implementation choices; add a keyword graph only when it demonstrates useful recall beyond the simpler route.

Use explicit tutor feedback to update reusable behaviour, whether expressed calmly or with frustration. Apply feedback at its stated scope. Topic-specific adjustments stay in the topic; lasting preferences use `behaviour.md`. Frustration by itself supplies no permanent preference. Follow the existing adaptation and recording rules in `SKILL.md`.

Current summaries in learner-facing notes must not expose pending answer keys or a solution to an active retry. Use the assessment boundary in `SKILL.md` when deciding what can be recorded or displayed before an attempt.
