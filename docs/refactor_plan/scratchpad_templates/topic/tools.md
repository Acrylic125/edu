# Tools

## State management backend
 The `scratchpad.state.json` is managed by a StateService which are exposed as tool calls for the agent. Each call requires a Mutex for a given change.

Writers (NOT READ) will FORCE the thread to be added as threadTutors in the topic state. Include this in each writer function.

### Tutor Agent Tools
`getMistakesForTopic(topics: TopicId[] | null)` -> Mistakes across topics if null
  - Call only when creating questions that evaluates the provided topic(s) OR explicitly asked
`whereAmI(topicId, threadId)` -> TopicPart and progress of current thread
`whatIsNext(topicId)` -> List of TopicPart and progress  
  - Call only when the thread is fresh OR when explicitly asked OR upon completion of part / part step.
  - Include existing threadTutors with "active", parts. Each option is "Continue from <question>"
  - Include the VERY NEXT part that has not been addressed by any threadTutors. Option is "Continue to <part>"
`getQuestions(topicId, topicPartId)` -> Questions asked across all threads
  - Call only when explicitly asked OR when trying to come up with questions to dedupe questions.
`documentMistake(topicId, topicPartId, context, issue)` -> None
  - Call only when a question is incorrectly answered (See Evaluate Understanding)
  - Saves the mistake (WRITES)
`complete(topicId, topicPartId, threadId)` -> None
  - Call only when ALL part goals have been satisfied for the part. Agent must deduce this 
  - Marks topic part as complete for threadId (WRITES)
`activatePart(topicId, topicPartId, threadId)` -> None
  - Call only when the part is visited by the thread
  - Marks topic part as active for threadId (WRITES)
`createTopic(Topic without id/createdAt, threadId)` -> None
  - Call only when a topic is EXPLICITLY created / asked to be created / a prerequisite topic needs to be created.
  - Creates the topic `{topicId}` folder, comprising of: `scratchpad.md`, `scratchpad.state.json`, `assets` (WRITES)
