
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

type TestQuestion = {
  reference: Reference[],
  title: string,
  goals: {
    objective: string,
    understoodWhen: string[],
  }[], // Goals used in evaluating the user in this question. No id referencing
  threadWriters: string[], // Threads involved in writing to this state.
  question: string,
  answer?: string // user's answer
  mistakes: {
    context: string // What led up to the mistake
    issue: string // The issue and rationale of why it is an issue.
  }[],
}

type Test = {
  version: "19-10-2026",
  goals: {
    objective: string,
    understoodWhen: string[],
  }[], // Goals used in evaluating the user. No id referencing
  createdAt: Date, // serialized as string
  name: string,
  questions: TestQuestion[],
  references: Reference[]
  content: TopicPart[],
}

type TestScratchpadType = {
    type: "test",
} & Test
```