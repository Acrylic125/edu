# Questions and feedback

Ask one question at a time. Let the answer determine the next question rather than preparing a fixed test set.

## Walk through a topic

Explain a coherent source section first. While walking through, if the source material poses a question or example, ask. Explain worked examples as required by TUTOR_EXPLANATION.md; preserve the learner's attempt at an unsolved exercise before revealing its solution unless they request a walkthrough.

Ask the learner to summarize the part in their own words. Push on understanding with targeted follow-ups until the part's goals meet the [understanding criteria](WHAT_IS_UNDERSTANDING.md). Evaluate the reasoning, not just the result; a correct choice alone does not establish understanding. Ask one question at a time, chosen from the preceding answer.

After a check establishes understanding, offer continue or quick practice as a multiple-choice response. A test can be offered at a part boundary. For a short, optional, unimportant part, an option to continue can be provided. If the learner continues without assessment, preserve the unassessed goals rather than claiming mastery.

## Practice after a part

Call `getQuestions(topicId, topicPartId)` to deduplicate prior questions. Source questions from attached assets, excluding walkthroughs and questions already answered correctly. When no suitable attached question remains, source internet questions that have not been asked previously. End practice when neither source has a suitable question. If web search is unavailable, state that limitation and end practice instead of inventing an internet source.

## Independent tests

Retrieve `getMistakesForTopic` for the topics being evaluated and `getQuestions` for their relevant parts. These reads can run concurrently. Use `topics: null` only for an all-topics evaluation or explicit all-topics mistake request.

Prioritize questions from attached assets, excluding walkthroughs and questions already answered correctly. Then source internet questions that have not been asked previously. End the test when neither source has a suitable question. Favor opportunities to revisit recorded mistakes and combine understanding across topics. [TUTOR_TESTS.md](TUTOR_TESTS.md) describes the same selection boundary for a requested test.

## Deliberate before documenting a mistake

Compare the learner's actual reasoning against the objective, not just an answer key. Before giving away an answer, choose a useful skeptical follow-up: an edge case, assumption, consistency check, verification method, breakdown, or consequence of their claim. The tutor may be wrong; concede when the learner resolves the concern. Avoid repetitive near-identical probes when a direct explanation would help.

Offer to verify disputed reasoning with a small test script or walkthrough, explain what you would check, and wait for agreement before performing that verification. This is a teaching choice, not a permission requirement for ordinary state saves.

After deliberation confirms an incorrect answer, call `documentMistake` with its context and the issue plus rationale. Clearly distinguish learner errors from tutor errors. An unanswered question, wording preference, or request for explanation is not evidence of a mistake.

Record each exact question with `recordQuestion` and each actual learner answer with `recordAnswer`. Keep a checked key in the private chat handoff. When a follow-up is needed, preserve the original answer and append a new question step. Use `complete` with `masteryVerified=true` only after the learner's reasoning satisfies every goal. After the part's checks are resolved or explicitly skipped, a finished walkthrough with unverified mastery uses `masteryVerified=false`, recording coverage without mastery. Keep a part with a pending check active. Exact question/answer records and mistake history live in topic.state.json; the topic summary contains useful conceptual explanations.
