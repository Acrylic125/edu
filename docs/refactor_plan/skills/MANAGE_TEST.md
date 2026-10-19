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
1. Create scratchpad name.
2. Create test (`createTest`).
3. Source topics, ask what topics are to be tested
4. Validate a list of objectives for the test.
  - User confirms, proceed to walking part by part.
  - User declines, make changes.

## Explaining
When needed, [explain in this style](WRITING_STYLE.md).

## Asking Checks and Questions

Always go question by quesiton, it is dynamic what quesitons can be asked so no "Fixed Test Set".

### Instructions:
1. Retrieve mistakes for all the topics involved (`getMistakesForTopic`)
2. Retrieve the topic's questions (`getQuestions`)
3. Source questions 
(1 and 2 can be done concurrently)

Prioritise the following to source questions. 
1. Source questions from attached assets (NOT FROM WALK THROUGHS). Move to (2) IF the question was asked previously / None available AND was answered correctly.
2. Source questions from the internet. Move to (3) IF the question was asked previously. 
3. End of practice

Prioritise questions that:
- Contains areas to make past mistakes made by the user for the topic.
- Requires a combination of cross topic understanding.

## Feedback and Deliberating
After the user answers, give [FEEDBACK and DELIBERATE on the answer](FEEDBACK_AND_DELIBERATE.md)

Afterwards, document mistakes for the part in the state file.

## Maintain Scratchpad
Contains the questions, and answers posed by the user.