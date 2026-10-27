# Tools

## State management backend
The `scratchpad.state.json` is managed by a StateService which are exposed as tool calls for the agent. Each call requires a Mutex for a given change.

Writers that change a question FORCE the thread into that question's `threadWriters`. Include this in `createTest` for each question in the payload, `addQuestion`, and `recordAnswer`. Reads leave `threadWriters` unchanged. `documentMistake` writes a content part and does not change `threadWriters`.

### Tutor Agent Tools
`test_getCoveredTopics(scratchpads: TopicId[] | null, offset?: number, limit?: number)` -> Paginated coverage inventory
  - For a new test, null selects all granted workspace topics. For an existing test, null uses its saved source topic references. An explicit list selects the requested scope; an empty list selects none.
  - Returns topic and part IDs, names, planned objectives, coverage status, question and answer counts, and taught block counts. Each page contains up to limit parts. The default limit is 25; the maximum is 100. Follow nextOffset until it is null.
  - Completed parts and partial parts with recorded questions or section-linked lesson text appear in the inventory. Activation alone and untouched curriculum are excluded.
  - Planned objectives can include untaught concepts. Read detailed evidence for the selected part before using partial coverage. Leaves progress unchanged.
`read_topic_evidence(scratchpadId, scratchpadPartId, offset?: number, limit?: number)` -> One part's teaching evidence
  - Returns the selected part's goals, mistakes, progress across tutor threads, recorded questions and answers, and section-linked content blocks as paginated JSON text in evidence.
  - offset and limit count characters. The default and maximum limit is 20,000. Follow nextOffset for the required history. The response includes totalCharacters and coverage counts.
  - Use the inventory to choose relevant parts, then read their evidence. Initial prompts contain focused context; full lesson and answer history is available through this tool.
`getMistakesForTopic(scratchpads: TopicId[] | null)` -> Mistakes across topics if null
  - Call only when creating questions that evaluates the provided topic(s) OR explicitly asked
`getMistakes(testId)` -> Mistakes on content parts
  - Call only when creating questions that evaluate this test OR explicitly asked
`whereAmI(testId, threadId)` -> Open TestQuestion for this thread
  - The question in this thread's `threadWriters` that has no answer. When this thread has none, the first question with no answer.
`getQuestions(testId)` -> Questions in this test
  - Call only when explicitly asked OR when trying to come up with questions to dedupe questions.
`documentMistake(testId, scratchpadPartId, context, issue)` -> None
  - Call only when a question is incorrectly answered (See Evaluate Understanding) AND the mistake maps to a content part
  - Saves the mistake on that content part (WRITES)
`addQuestion(testId, TestQuestion without threadWriters or answer, threadId)` -> None
  - Call only when sourcing the next question, one question at a time
  - Appends the question and adds its section to `scratchpad.md` (WRITES)
`recordAnswer(testId, title, answer, threadId)` -> None
  - Call only when the user answers the question with that title and that question has no answer yet
  - Saves the answer under that question in `scratchpad.md` (WRITES)
  - A later attempt is a new question. Each TestQuestion stores one answer.
`createTest(Test without createdAt, questions without threadWriters or answer, threadId)` -> None
  - Call only when a test is EXPLICITLY created / asked to be created
  - Questions in the payload may be empty. Further questions go through `addQuestion`.
  - Creates the `{testId}` folder, comprising of: `scratchpad.md`, `scratchpad.state.json`, `assets` (WRITES)

## Structured document edits

Use `test_editContent` to add, edit or delete blocks in JSON. Read current block IDs first. All changes in one call are atomic. `present` selects the ordered stored blocks to render in the current reply. The app manages revision checks and generates Markdown and navigation. Curriculum changes use the role's update tool; learning evidence uses its question, answer, mistake and progress tools.
