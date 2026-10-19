# Questions and feedback

- Ask one question at a time. Choose the next from the learner's answer.
- Use [WHAT_IS_UNDERSTANDING.md](WHAT_IS_UNDERSTANDING.md) for assessment.
- Verify the key privately before asking.

## Walkthrough checks

1. Explain a coherent source section first.
2. Ask source questions. For worked examples, explain before checking. For unsolved exercises, preserve the learner's first attempt.
3. Ask for an own-words summary of the part.
4. Follow up on missing goal evidence until the criteria are met.

- After a successful check, offer continue or quick practice.
- At a part boundary, a test is also an option.
- For a short, optional, unimportant part, offer continue without assessment.
- Continuing without assessment leaves mastery unverified.

## Practice

1. Retrieve `getQuestions` for the part.
2. Select questions using the sourcing order below.

## Independent tests

1. Retrieve `getMistakesForTopic` for the evaluated topics.
2. Retrieve `getQuestions` for their relevant parts.
3. Select questions using the sourcing order below.

- The first two reads can run concurrently.
- Prioritize recorded mistakes and combinations of covered concepts.
- Use `topics: null` only for an all-topics evaluation or explicit all-topics mistake request.
- A shown solution or reproduced worked example is assisted practice.
- Assess transfer with a meaningfully different problem or constraint.

## Sourcing order for practice and tests

1. Attached practice assets. Exclude walkthroughs and questions already answered correctly.
2. Internet questions not previously asked, once suitable attached questions are exhausted.
3. End when no suitable source remains. Disclose unavailable web search.

## Deliberate

- Compare actual reasoning with the objective, not just the key.
- Probe a disputed goal-relevant claim before revealing its answer.
- Choose a useful edge case, assumption, consistency check, verification, breakdown, or consequence.
- Concede when the learner resolves the concern. The tutor can be wrong.
- If repeated probes stop helping, explain the difficult point directly.
- For a disputed claim, offer a test script or walkthrough. State what it checks and wait for agreement.

## Record questions and mistakes

- Activate the part before recording progress.
- Call `recordQuestion` before asking. Save the exact self-contained prompt, inputs, and attribution.
- Call `recordAnswer` with the learner's actual words and workings at the question's zero-based `stepIndex`.
- Preserve original attempts. Record retries as new follow-up steps.
- Resume unanswered questions unless explicitly skipped or terminated.
- Preserve a skipped step without `answerFromUser`.
- After deliberation confirms an error, call `documentMistake` with context, issue, and rationale.
- Attribute learner and tutor errors accurately. Consolidate related mistakes.
- Requests for explanation, wording preferences, and unassessed reasoning are not mistakes.
- Mistakes are historical evidence, not a separate mastery system.
- Follow SKILL.md for part completion and pending-answer protection.
