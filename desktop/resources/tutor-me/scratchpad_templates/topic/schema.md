# Topic state

`scratchpad.state.json` owns the complete saved state. The app generates `scratchpad.md` from it. The state shape includes learning evidence and thread coordination alongside the structured document.

```ts
type TopicPartId = `tp-${string}`

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
  id: TopicPartId,
  parent?: { id: TopicPartId }
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
  createdAt: string, // ISO datetime
  name: string,
  content: TopicPart[],
  revision: number,
  document: ContentDocument,
  threadTutors: {
    id: string // thread id 
    progress: {
      [partId: TopicPartId]: {
        status: "active" | "completed" // Can transition back and forth
        steps: {
          question: string,
          answerFromUser?: string // answer may not be provided (i.e. termination / not yet answered)
          check?: TopicCheck,
          assessment?: TopicAnswerAssessment,
          assessmentHistory?: TopicAnswerAssessment[],
          additionalAnswers?: { messageId: string, answerFromUser: string }[],
          resumeFrom?: { threadId: string, stepIndex: number },
          reviewStartIndex?: number // Managed by the host when a completed part starts practice
        }[]
      }
    }
  }[]
}

type TopicScratchpadType = {
    type: "topic",
} & Topic
```

## Shared thread coordination

`TopicCheck` selects zero-based `goalIndex` and `criterionIndex` from the part's existing goals and states `reasoningTask`, `missingEvidence`, and `expectedEvidence`. `TopicAnswerAssessment` selects the same criterion. It stores `status` as `demonstrated`, `uncertain`, or `contradicted`, with `evidence` entries containing `stepIndex` and the complete verbatim answer in `quote`. It separates `interpretation` from that evidence and retains a `remainingGap` for unresolved understanding. These private assessment fields remain in structured state rather than the public walkthrough. Legacy steps may omit them.

`threadTutors` is shared state that lets threads see what other threads are doing. Each entry identifies a writing thread and stores its per-part status and ordered question/answer steps. An absent `answerFromUser` means the recorded question has no answer yet, including a terminated or skipped check.

The backend registers the current thread on a successful topic write. Reads leave `threadTutors` unchanged. Writes preserve every other thread's entry, status, questions and answers. Content block edits preserve all recorded progress.

Use the initial `topicProgress` and `whatIsNext` snapshot to see other threads' active work and completed parts. Read the full state with `read_scratchpad`; refresh cross-thread progress with `topic_getTopicProgress`, continuations with `topic_whatIsNext`, and question history with `topic_getQuestions` when their tool conditions apply. Preserve existing attempts and use the recorded history to coordinate continuation and avoid duplicate questions.

## Goals and mistakes

Every curriculum part retains `goals`, including each goal's `objective` and `understoodWhen` criteria, and `mistakes`, with the context and rationale of each confirmed error. Use those criteria to evaluate understanding before marking a part completed. Preserve recorded mistakes when changing the curriculum; add confirmed mistakes with `topic_documentMistake`. Explanation edits leave goals, mistakes and progress intact.

## Structured document

State contains a name, curriculum parts, revision, and a document with `version: 1` and ordered `blocks`. A curriculum parent is a reference `{ "id": "tp-parent" }`. Each block has a stable unique `id`:

- `markdown`: `content` is an array of Markdown lines; optional `sectionId` refers to an existing curriculum part.
- `source`: `materialId`, `page`, `presentation` (`link` or `image`), and optional `sectionId`.
- `term`: `term` and `meaning`.

Call `topic_editContent` with ordered add/edit/delete changes. `edit` replaces a block while retaining its ID. `delete` takes `id`. `add` takes `block`, with optional `afterId` for placement. Set `present` to block IDs to show in chat. Read current IDs before editing; a rejected call changes nothing. The app manages revision checks.

`ContentDocument` has `version: 1` and an ordered `blocks` array. The backend manages `revision`. Older state without `document` is imported once while preserving goals, mistakes and thread history.
