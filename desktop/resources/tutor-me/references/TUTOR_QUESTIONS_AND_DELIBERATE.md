# Questions and feedback

Ask one question at a time. Let the answer determine the next question rather than preparing a fixed test set.

## Walk through a topic

Explain a coherent source section first. If it contains a question or example, ask the relevant question after teaching the concepts. For an unsolved exercise, preserve the learner's chance to attempt it. Ask the learner to summarize the part in their own words. Probe the reasoning until the part's goals and [understanding criteria](WHAT_IS_UNDERSTANDING.md) are met.

## Practice after a part

Call `getQuestions(topicId, topicPartId)` to deduplicate prior questions. Source exercises from attached practice assets, excluding walkthrough examples. Reuse an earlier question for remediation only when it was not correctly answered, and identify the attempt as assisted practice. Move to internet questions when no suitable unused attached exercise remains; if none can be sourced, end practice. If web search is unavailable, state that limitation and end practice instead of inventing an internet source.

## Independent tests

Retrieve `getMistakesForTopic` for the topics being evaluated and `getQuestions` for their relevant parts. These reads can run concurrently. Use `topics: null` only for an all-topics evaluation or explicit all-topics mistake request.

Prioritize attached practice assets, then internet questions, then end the test when neither has a viable unused question. Exclude walkthrough examples and questions already answered correctly. Favor opportunities to revisit recorded mistakes and combine understanding across topics. Increase difficulty based on demonstrated understanding. [TUTOR_TESTS.md](TUTOR_TESTS.md) describes the same selection boundary for a requested test.

## Deliberate before documenting a mistake

Compare the learner's actual reasoning against the objective, not just an answer key. Before giving away an answer, choose a useful skeptical follow-up: an edge case, assumption, consistency check, verification method, breakdown, or consequence of their claim. The tutor may be wrong; concede when the learner resolves the concern. Avoid repetitive near-identical probes when a direct explanation would help.

Offer to verify disputed reasoning with a small test script or walkthrough, explain what you would check, and wait for agreement before performing that verification. This is a teaching choice, not a permission requirement for ordinary state saves.

After deliberation confirms an incorrect answer, call `documentMistake` with its context and the issue plus rationale. Clearly distinguish learner errors from tutor errors. An unanswered question, wording preference, or request for explanation is not evidence of a mistake.

Record each exact question with `recordQuestion` and each actual learner answer with `recordAnswer`. Keep a checked key in the private chat handoff. When a follow-up is needed, preserve the original answer and append a new question step. Use `complete` only after the learner's reasoning satisfies every goal. Exact question/answer records and mistake history live in topic.state.json; the topic summary contains useful conceptual explanations.
