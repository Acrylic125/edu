## Context
I want to make a change with what `topic.md` is used for. Currently, it is treating it as topic progress state (Similar to `topic.workpad.md`). However, it is redundant. `topic.md` should be used as a summary of the topic, rather than state. 

## Schemas
NOTE: Paths are relative to the placement of the `topic.state.json`

type PageRange = {
  from: number,
  to: number
}

TopicReference = {
  type: "pdf" | "ppt",
  path: string,
  pages: PageRange[]
} | {
  type: "image",
  path: string
} | {
  type: "website",
  url: string
}

TopicPart = {
  id: `tp-${string}`, // TopicPartId
  parent?: TopicPart // May not have a parent
  name: string,
  references: TopicReference[],
  goals: {
    id: `tpg-${string}` // TopicPartGoalID
    objective: string,
    understoodWhen: string[],
  },
  mistakes: {
    context: string // Question, and what led up to the mistake
    issue: string // The issue and rationale of why it is an issue.
  }[],
}

`topic.state.json` (Topic) = {
  version: "11-10-2026",
  createdAt: Date, // serialized as string
  name: string,
  content: TopicPart[],
  threadTutors: {
    id: string // thread id 
    progress: {
      [partId: TopicPartId]: {
        status: "active" | "completed" // Can transition back and forth
        steps: {
          question: string,
          answerFromUser?: string // answer may not be provided (i.e. termination / not yet answered)
        }[]
      }
    }
  } // ONLY INCLUDES THREADS THAT WRITES TO THIS TOPIC STATE! Threads that refer to this topic not counted. Threads that walk through this topic ARE counted (needs to write state).
}

## State management backend
 The `topic.state.json` is managed by a StateService which are exposed as tool calls for the agent. Each call requires a Mutex for a given change.

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
  - Creates the topic `{topicId}` folder, comprising of: `topic.md`, `topic.state.json`, `assets` (WRITES)

## Agent Skills
### Question Generaiton
Refer to [QUESTIONS](QUESTIONS.md)

### Evaluate Understanding
Given a set of goals (Be it from part OR the goals of the question being asked), evaluate whether they are being met in reference to [What is Understanding](WHAT_IS_UNDERSTANDING.md)

### Explanation Style
Refer to [EXPLANATION_STYLE](EXPLANATION_STYLE.md)

## Conflict Resolution
In situations where the user has multiple continuation points, ASK FOR OPTIONS