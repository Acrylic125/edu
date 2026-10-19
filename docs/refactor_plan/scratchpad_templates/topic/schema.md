
```ts
type PageRange = {
  from: number,
  to: number
}

type Reference = {
  type: "pdf" | "ppt",
  path: string,
  pages: PageRange[]
} | {
  type: "other-file",
  path: string,
} | {
  type: "image",
  path: string
} | {
  type: "website",
  url: string
} | {
  type: "topic",
  id: string
}

type TopicPart = {
  id: `tp-${string}`, // TopicPartId
  parent?: TopicPart // May not have a parent
  name: string,
  references: Reference[],
  goals: {
    objective: string,
    understoodWhen: string[],
  }[],
  mistakes: {
    context: string // Question, and what led up to the mistake
    issue: string // The issue and rationale of why it is an issue.
  }[],
}

type Topic = {
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

type TopicScratchpadType = {
    type: "topic",
} & Topic
```