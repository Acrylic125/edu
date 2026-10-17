# Recorded mistakes

Use `documentMistake(topicId, topicPartId, context, issue)` after deliberation confirms an incorrect answer. Context includes the question and relevant learner/tutor statements. Issue describes what went wrong and why, attributing errors accurately. An explanation request or unassessed answer is not a mistake.

Mistakes live on their part in topic.state.json and remain available after a thread finishes. Read them with getMistakesForTopic only for evaluation-question generation or an explicit request. Exact answers remain in structured question steps. Keep temporary remediation and checked keys in the private chat handoff. The conceptual topic summary does not hold individual mistake records.
