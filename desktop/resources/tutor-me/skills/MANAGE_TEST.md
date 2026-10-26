---
name: manage-test
description: Manage scratchpads of type, "test". Extract "type" from `{scratchpad}.scratchpad.state.json`
---

# Manage Test

## Test Flow
1. Create Test if not exist
2. Walk through test questions 1 at a time, 
  - Ask question
  - User answers
  - Deliberate
  - If needed, record mistakes

## Creating Test

Steps:
1. Discover the covered scope with `test_getCoveredTopics`. For a new test, use `topics: null` for all granted workspace topics unless the learner named a narrower scope. Follow `nextOffset` until the requested inventory is complete. The inventory summarizes coverage across tutor threads without loading their lesson text or answer history.
2. Use completed parts as covered. Before selecting questions for a partial part, call `read_topic_evidence` with its topic and part IDs. Read its recorded questions, answers, and lesson blocks to identify the concepts introduced. Follow `nextOffset` for the required evidence. Inventory objectives describe the plan; actual teaching evidence establishes partial coverage. Exclude untouched parts and untaught portions of active parts. If teaching evidence is missing or ambiguous, clarify the covered scope.
3. Create the test with references to the source topics and objectives drawn from this covered scope. When scope is already clear from the request and evidence, proceed; otherwise validate the objectives with the learner.
4. Save the source topic references in the test and a per-part coverage tally in the private handoff. On later turns, `topics: null` uses those saved source topics. Preserve the agreed scope; supply an explicit topic list when the learner requests a change.

## Explaining
When needed, [explain in this style](WRITING_STYLE.md).

## Asking Checks and Questions

Ask one question at a time. Select questions dynamically across the full agreed covered scope.

Before each question:
1. Restore the saved coverage tally and inspect the coverage inventory for the agreed source topics. Read the test's existing questions to avoid repeating an assessment.
2. Choose an eligible part with the fewest questions so far. Read that part with `read_topic_evidence` to check its earlier walkthrough questions, answers, and mistakes. Rotate across all covered parts before repeating one; use past mistakes to break ties. Recency does not increase a part's priority. Count a cross-topic question against each part it actually assesses.
3. Select a question using the Question Sources rules below. Verify every required concept and prerequisite against the covered scope, including for mixed-topic exercises.
4. Add the question with references to its source topics, goals matching the covered concepts, and its source reference. Save the updated tally and next part in the private handoff. Continue using the agreed scope when resuming an existing test; correct any earlier out-of-scope selection.

Prefer questions that exercise past mistakes or combine covered concepts after satisfying the coverage rotation. A cross-topic question must use only concepts already taught.

## Question Sources

Use a question from topic assets if and only if the source explicitly identifies it as an exam or exam-preparation question, such as a past-year paper, sample exam, or textbook practice exercise, and that question has not already been covered or asked. Read the source with `read_material` to verify its purpose and the actual question before selecting it. An ambiguous source is ineligible.

Lecture slides, tutorials, worked examples and walkthrough checks are ineligible question sources, including their quizzes and "try it yourself" exercises. Use these materials only to establish what concepts were taught. Rewording a question or changing its values does not make it a new eligible source.

If no eligible, unused question is available in the topic assets, search online for an exam or exam-preparation question within the covered scope. Inspect the original source and retain its URL and question identifier or page in the question references. Apply the same source and duplication rules to online questions; lecture slides and tutorials remain ineligible.

If online search is unavailable or no suitable question can be verified, explain the limitation and stop sourcing questions. Do not substitute a generated question or a question from an ineligible source.

## Feedback and Deliberating
After the user answers, apply [Feedback and Deliberate](FEEDBACK_AND_DELIBERATE.md) to the accumulated answers for that question. Continue to the next question once its substantive objectives are demonstrated. Create a follow-up only for a specific unresolved gap; preserve the original objectives rather than adding requirements for incidental details.

Afterwards, document mistakes for the part in the state file.

## Maintain Scratchpad
Contains the questions, and answers posed by the user.
