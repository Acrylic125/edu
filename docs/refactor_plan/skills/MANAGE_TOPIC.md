---
name: manage-topic
description: Manage scratchpads of type, "topic". Extract "type" from `{scratchpad}.scratchpad.state.json`
---

# Manage Topic

## Topic Flow
1. Create Topic if not exist
2. Walk through part by part, 
 - Each part contains sections. Each section:
    - Explain section
    - Ask checks for section
    - If needed, record mistakes
 - Practice part
    - Ask practice questions
    - If needed, record mistakes

## Creating Topics

Steps:
1. Create scratchpad name.
2. Create topic (`createTopic`).
3. Source topic parts, identify [What needs to be understood](WHAT_IS_UNDERSTANDING.md) given each part.
4. Propose Plan, ask use for confirmation.
  - User confirms, proceed to walking part by part.
  - User declines, make changes.

### Sourcing Topic Parts
Prioritise the creation topics using the following:
1. If have Attached Sources. Create the topic parts using the attached sources.
2. Else, use web search to find a walkthrough.

If there are multiple flows, you can merge flows.

## Explaining
[Explain in this style](WRITING_STYLE.md).

## Asking Checks and Questions

2 Scenarios,
1. Walking through a topic (Checks)
2. Practice after a topic part (After 1)

Always go question by quesiton, it is dynamic what quesitons can be asked so no "Fixed Test Set".

### 1. While walking through a topic
Topic evaluation happens as the topic is being walked through. 

1. While walking through, if the source material (i.e. slides/textbook walk throughs) poses a question OR examples, ask.
2. Ask them to use their own words to summarise the part. Push hard on understanding, keep pushing until the goals met while satisfying [WHAT IS UNDERSTANDING](WHAT_IS_UNDERSTANDING.md)

### 2. Practice after topic part
Can happen right after (1) of a topic part OR at the end of the topic.

1. Retrieve the topic's questions (`getQuestions`)
2. Source Questions

Prioritise the following to source questions. 
1. Source questions from attached assets (NOT FROM WALK THROUGHS). Move to (2) IF the question was asked previously / None available AND was answered correctly.
2. Source questions from the internet. Move to (3) IF the question was asked previously. 
3. End of practice

## Feedback and Deliberating
After the user answers, give [FEEDBACK and DELIBERATE on the answer](FEEDBACK_AND_DELIBERATE.md)

Afterwards, document mistakes for the part in the state file.

## Maintain Scratchpad
The scratchpad is a story summary of the topic being covered. 
1. Identify an **overarching example** at the start. 
2. [Explain](WRITING_STYLE.md) each part of the topic using that example, tie the parts together.
3. When user makes a mistake / clarifies, update the explaination to clarify that mistake.

Tell a story. The story can evolve and change. Disjointed ideas MUST NOT be shoehorned in, you can consider isolating it into it's own example.