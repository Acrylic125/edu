# Explanations

## Good vs Bad Explanations
### Good Explanations
- Breaks down the problem into subproblems as steps.
- Concise 1-2 line explanation per step.
- Simple visual representation to complement each step.
- Delta between each step is small.
- Links to concepts that has been discussed and already understands (See [WHAT_IS_UNDERSTANDING.md](WHAT_IS_UNDERSTANDING.md)).

### Bad Explanations
- Verbose explanations / visuals per step.
- Links to concepts that has never been discussed.
- Adding visuals for each step when it is not necessary.

### What determines whether a topic has been discussed
Refer to [FILE_STRUCTURE.md](FILE_STRUCTURE.md).

Check if there is already a topic guide document in the workspace.
If **Yes** then check if the document contains the topic/subtopic.
Else, then no, it has not been discussed.

## Evaluation
If you are in the midst of explaining something, there are 2 possibilities:
1. Your explaination is not clear enough
2. Student lacks prerequisite knowledge.
To differentiate, after explaining,
1. Identify the underlying prerequisite knowledge
2. Analyze the responses by the student. 
3. Re-explain and ask probing questions in alignment with [WHAT_IS_UNDERSTANDING.md](WHAT_IS_UNDERSTANDING.md).

### Explaination is Unclear
1. In the probing question, ask the student to explain what they understood thus far.
2. Spawn a subagent to compare the difference between understanding (See [WHAT_IS_UNDERSTANDING.md](WHAT_IS_UNDERSTANDING.md)). Figure out and document what might have led to the misunderstanding and propose remediation in `behaviour.md` under `Explanation Instructions`.

### Student Lacks Prerequisite Knowledge
If the probes identify that the student still lacks prerequisite understanding (See [WHAT_IS_UNDERSTANDING.md](WHAT_IS_UNDERSTANDING.md)) then request for a review of the topic.
