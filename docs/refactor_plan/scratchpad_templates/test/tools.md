# Tools

## State management backend
The `scratchpad.state.json` is managed by a StateService which are exposed as tool calls for the agent. Each call requires a Mutex for a given change.

Writers that change a question FORCE the thread into that question's `threadWriters`. Include this in `createTest` for each question in the payload, `addQuestion`, and `recordAnswer`. Reads leave `threadWriters` unchanged. `documentMistake` writes a content part and does not change `threadWriters`.

### Tutor Agent Tools
`getMistakesForTopic(topics: TopicId[] | null)` -> Mistakes across topics if null
  - Call only when creating questions that evaluates the provided topic(s) OR explicitly asked
`getMistakes(testId)` -> Mistakes on content parts
  - Call only when creating questions that evaluate this test OR explicitly asked
`whereAmI(testId, threadId)` -> Open TestQuestion for this thread
  - The question in this thread's `threadWriters` that has no answer. When this thread has none, the first question with no answer.
`getQuestions(testId)` -> Questions in this test
  - Call only when explicitly asked OR when trying to come up with questions to dedupe questions.
`documentMistake(testId, topicPartId, context, issue)` -> None
  - Call only when a question is incorrectly answered (See Evaluate Understanding) AND the mistake maps to a content part
  - Saves the mistake on that content part (WRITES)
`addQuestion(testId, TestQuestion without threadWriters, threadId)` -> None
  - Call only when sourcing the next question, one question at a time
  - Appends the question and adds its section to `scratchpad.md` (WRITES)
`recordAnswer(testId, title, answer, threadId)` -> None
  - Call only when the user answers the question with that title and that question has no answer yet
  - Saves the answer under that question in `scratchpad.md` (WRITES)
  - A later attempt is a new question. Each TestQuestion stores one answer.
`createTest(Test without createdAt, questions without threadWriters, threadId)` -> None
  - Call only when a test is EXPLICITLY created / asked to be created
  - Questions in the payload may be empty. Further questions go through `addQuestion`.
  - Creates the `{testId}` folder, comprising of: `scratchpad.md`, `scratchpad.state.json`, `assets` (WRITES)
