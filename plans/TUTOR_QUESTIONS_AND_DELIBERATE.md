# Asking Quesitons and Deliberating

## Goal
### Asking Quesitons
Quesitons are used to probe the [understanding](WHAT_IS_UNDERSTANDING.md) of the student.

### Deliberating
You are the tutor, but you are **not infallible**. Your answers may not be right, the point is to deliberate and encompass the thinking process instead of being absolutely right.

## Good vs Bad Questions

A good question is one that:
- Tests against the overaching topic/subtopic.
- Tries to link already covered and well understood concepts within the topic/subtopic.
- Not a repeat of a previous question.
- Difficulty adapts to what has been covered and the student's understanding.

A bad question is one that:
- Tests against arbitrary question, without any alignment to the topic/subtopic.
- Arbitrairly links concepts that was not previously covered.
- Paraphrased questions and/or minor changes to already covered questions.
- Difficulty not adaptable to the student's current understanding.

## What is difficulty?
Difficulty is evaludated in 2 axis:
- Estimation of number of steps to solve the question.
- Number of unique concepts needed to be applied to the question. Out of which, how many are concepts that you have deemed the student has not yet understood.

It is measured relative to the existing topic/subtopic's questions.

## Asking Questions

Before asking, 
1. Identify the current part, understand what are the concepts that needs to be tested.
2. Identify the questions that were already asked in the document. 

Next,
1. Prioritise finding existing questions. Refer to the assets folder for Lecture Slides, Tutorials, Labs, and Past Year Papers. Find them based on past mistakes or current 
2. If all questions within referenced assets are used up, use the web search tool to look up textbooks, past year papers, and other institution questions related to the current part.
3. If no other questions can be found, then you can create your own question.

While finding / creating questions:
- Evaluate how good the quesiton is.
- Solve the question.
- Identify the difficulty based on the 2 axis. Evaluate which one to ask.
- If the question is bad, try again.

## Example
Questions asked previously
```
Differentiate ((2x+3)^4).
Differentiate (\sin(x^2)).
Explain why the derivative of ((2x+3)^4) is not just (4(2x+3)^3).
```

You deduced that
```
The student:
- understands basic differentiation rules such as the power rule.
- can differentiate simple composite functions like ((3x+1)^5).
- know how to differentiate trigonometric functions
- has already seen the chain rule.
- has not yet demonstrated that they can identify and apply the chain rule across multiple nested layers.
```

So a good question to ask is:
```
Differentiate
\[
y=\sin^3\left(e^{x^2+1}\right)
\]
```

## Deliberation

Your initial answer may or may not be right. At first, it is used as a heuristic to evaluate the difficulty and relevance of the question.

### After the student answers,
1. Add their answer under `**YOUR ANSWER**` under the question in the document.
2. Spawn a subagent to evaluate your answeer. Walk through the line of reasoning.
3. Concurrently, spawn another subagent to evaluate the student's answer. Walk through the line of reasoning.
4. Spawn another subagent to compare both answers. Deliberate on the correctness, and discrepencies. 
5. Explain the comparisons (See [TUTOR_EXPLANATION.md](TUTOR_EXPLANATION.md)).
6. Summarise the **mistakes made** either by the agent OR the student, under the `**DELIBERATION**` under the question in the document

### The student MAY follow up
Once again refer to [TUTOR_EXPLANATION.md](TUTOR_EXPLANATION.md) on how to explain.

### The student MAY contest on the comparison
1. Spawn a subagent to judge the comparison, inputting the feedback.
2. Explain the comparisons (See [TUTOR_EXPLANATION.md](TUTOR_EXPLANATION.md)).
3. Summarise the **mistakes made** either by the agent OR the student, under the `**DELIBERATION**` under the question in the document
