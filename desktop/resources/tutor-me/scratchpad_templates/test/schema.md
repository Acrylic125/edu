# Test state

`scratchpad.state.json` owns the complete saved state. The app generates `scratchpad.md` from it. The state shape includes learning evidence and thread coordination alongside the structured document.

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
  createdAt: string, // ISO datetime
  name: string,
  questions: TestQuestion[],
  references: Reference[]
  content: TopicPart[],
  revision: number,
  document: ContentDocument,
}

type TestScratchpadType = {
    type: "test",
} & Test
```

## Shared question coordination

Each saved `TestQuestion` retains `threadWriters: string[]` so other threads can see which threads are working on the question. The backend registers the current thread for each question created through `test_createTest` or `test_addQuestion`, and adds it once when `test_recordAnswer` records an answer. Creation inputs omit both `threadWriters` and `answer`; supplying either is rejected. `answer` stores only the learner's submitted response through `test_recordAnswer`. Keep model solutions in the private answer key, never in the question payload.

`read_scratchpad` and `test_getQuestions` expose the saved question state, including `threadWriters`, questions, answers, goals and mistakes. `test_whereAmI` selects this thread's unanswered question first, then the first unanswered question. Reads leave writer membership unchanged. Content block edits and content-part mistake writes preserve question writers and answer history.

## Goals and mistakes

The test, each question, and each curriculum part retain goals with `objective` and `understoodWhen`. Questions and parts retain `mistakes` entries with `context` and `issue`. Use the criteria to evaluate answers and the mistake rationale to guide subsequent practice. Preserve existing question goals, answers, mistakes and writers when editing document blocks. `test_documentMistake` records a mistake on its matching curriculum part.

`TopicPart`, including its goals, `understoodWhen` and mistakes, is defined in [the topic schema](../topic/schema.md).

## Structured document

State contains a name, curriculum parts, revision, and a document with `version: 1` and ordered `blocks`. A curriculum parent is a reference `{ "id": "tp-parent" }`. Each block has a stable unique `id`:

- `markdown`: `content` is an array of Markdown lines; optional `sectionId` refers to an existing curriculum part.
- `source`: `materialId`, `page`, `presentation` (`link` or `image`), and optional `sectionId`.
- `term`: `term` and `meaning`.

Call `test_editContent` with ordered add/edit/delete changes. `edit` replaces a block while retaining its ID. `delete` takes `id`. `add` takes `block`, with optional `afterId` for placement. Set `present` to block IDs to show in chat. Read current IDs before editing; a rejected call changes nothing. The app manages revision checks.

`ContentDocument` has `version: 1` and an ordered `blocks` array. The backend manages `revision`. Older state without `document` is imported once while preserving goals, mistakes and thread history.
