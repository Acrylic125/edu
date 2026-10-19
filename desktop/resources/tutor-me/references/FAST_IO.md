# State tool sequencing

## Read

- Batch independent reads.
- Reuse supplied status snapshots and cached source renders.
- Read only the source section needed with `read_material`.
- Use `getQuestions` for explicit history requests or question deduplication.
- Use `getMistakesForTopic` for evaluation-question generation or an explicit request.
- Follow SKILL.md for status and continuation reads.

## Write

- Use StateService tools for structured state. Every writer registers the current thread; reads leave membership unchanged.
- Use `updateTopic` for curriculum and summaries.
- Use the question guide for question, answer, and mistake records.
- Use SKILL.md for activation and completion.
- Writes stage, then replay against current state under the repository mutex.
- The final reply, topic writes, and private handoff commit together.
- Repair every rejected write with the same tool and target. A handoff save cannot repair a topic write.

## Save the handoff

1. Finish the other state writes.
2. Call `save_learning_state` once before the final reply.
3. Provide the learner-facing reply.

- `workpad` and `nextAction` require non-whitespace text, including status and confirmation turns.
- Record pending question keys, temporary preparation, and a concrete next action.
- If no question is pending, state the current status explicitly.
- `notes` is private chat context. Use `updateTopic.summary` for topic notes.
- Keep checked keys only in `privateAnswerKey` or the private `workpad`.
