# Tutor workspace

```text
<workspace>/
└── <topic-name>/
    ├── assets/
    │   └── answers/<check-id>/   # Original learner solution files, when supplied
    ├── agent.workpad.md
    └── topic.md
```

Reuse an existing matching topic. Copy supplied materials to its `assets/` using recognisable filenames, preserving originals and avoiding overwrites of different files. A stable existing link is sufficient when copying is impractical. Report missing or unreadable content.

## topic.md: study notes

A reader should be able to revise from this file without reconstructing the conversation. Follow the source's outline. Develop the sections actually covered, with explanations, source examples, Check questions and learner answers, strengths, and areas to revisit. Uncovered sections remain entries in the directory, without invented lesson content.

Consolidate repeated explanations and feedback under the concept they concern. Check entries are the exception to summarisation: preserve the exact question, all necessary code/data, actual learner answer, and links to original solution assets. Each has a stable ID and anchor. An unanswered check contains its question without empty answer/deliberation headings. Add deliberation only for a wrong learner answer, wrong tutor answer, or contention. Surrounding discussion remains concise study notes.

Keep one entry per observed learner mistake under a `Past Mistakes` heading beside the relevant concept, with a stable ID, current assessment/status, and evidence links. Read [DIFFICULTY_MEMORY.md](DIFFICULTY_MEMORY.md) when creating or revising these entries. Their resolution statuses evolve; preserve the past mistake, original attempts, and resolved entries. Existing topics can adopt this structure when evidence changes, without a bulk rewrite of historical notes.

For an evolving software POC, keep the latest sketch and its supporting evidence under a stable topic anchor, following [PSEUDOCODE_POC.md](PSEUDOCODE_POC.md#persist-and-resume). Link that anchor from the existing `Resume action` or `After resolution` handoff field so a fresh thread can recover it without the old chat. Existing active questions retain priority.

## Topic directory and sourcing

Use one bulleted outline following the source's section names, numbering, and order. Indent subparts beneath their parent, including sections continued in another lecture file. Link a part title to a stable in-document anchor only when its notes exist; leave an undocumented part's title plain. Append its source links on the same line. Keep lecture boundaries in the source labels rather than flattening the subject hierarchy into separate lecture lists.

Shorten source labels semantically: retain the material type, distinguishing lecture/part identifier, and extension, while dropping a repeated topic subtitle. For example, `Lecture 5A - Arrays, Strings and Structures.pdf` becomes `Lecture 5A.pdf`, not a clipped word with ellipses. Keep labels unambiguous when several sources have similar names. Shorten only the display label, preserving the actual filename in the link target.

Use `[Lecture 5A.pdf, pg. 5-6](<assets/Lecture 5A - Arrays, Strings and Structures.pdf#page=5>)`. Page numbers belong inside the linked label; use 1-based PDF file pages and add printed slide labels only when different. Anchor a PDF link to the first cited page with `#page=N`. Separate multiple source links with commas. Use relative asset links in `topic.md` and absolute local file links in chat.

Example directory (here, notes exist for Arrays and Array Parameters only):

```markdown
- [2. Arrays](#arrays) [Lecture 5A.pdf, pg. 5-6](<assets/Lecture 5A - Arrays, Strings and Structures.pdf#page=5>)
  - 2.1 Array Declaration with Initializers [Lecture 5A.pdf, pg. 7](<assets/Lecture 5A - Arrays, Strings and Structures.pdf#page=7>)
  - [2.4 Array Parameters in Functions](#array-parameters) [Lecture 5A.pdf, pg. 11-13](<assets/Lecture 5A - Arrays, Strings and Structures.pdf#page=11>), [ArraySumFunction.c](<assets/ArraySumFunction.c>)
```

In both chat and notes, place a `Sourced from:` line after the explanation or question, using the same compact, comma-separated links. Attribution supplements the teaching; explain the content directly rather than introducing it with repeated source narration or sending the learner elsewhere to read it. Include the relevant prompt, code, calculation, or diagram detail in the explanation itself. For adaptations or supplementary authored material, add a brief provenance label such as `(adapted)` or `Tutor-authored; aligned with ...`; a citation must not imply that invented content came from the source. Omit an empty source line for unsourced general teaching.

The Materials section can retain the complete file inventory, including alternate formats. Keep directory citations focused on the sources used for each part. Source maps should help the learner find the material, not document the agent's inspection process. When discussing any referenced item in chat, also display its relevant content using [TUTOR_EXPLANATION.md](TUTOR_EXPLANATION.md); these links are attribution and navigation, not substitutes for visible excerpts or images.

## agent.workpad.md: compact working state

Use an explicit handoff at the top:

```markdown
## Handoff
Current section: 2.3 Array Assignment
Phase: awaiting_answer
Active check: C2.3-01 — [question](topic.md#check-c2-3-01)
Last completed check: C2.2-01 (or none)
Resume action: Await/evaluate C2.3-01; remain in 2.3.
After resolution: Explain 2.4 Array Parameters in Functions, Lecture 5A pp. 11-13: how the function accesses elements and why it also needs the size (not yet started).

## Active check key
Check: C2.3-01
Expected answer and short justification: ...
Assumptions / relevant source: ...
```

Phases are `awaiting_plan_confirmation`, `awaiting_choice`, `awaiting_answer`, `awaiting_clarification`, `contested`, or `ready_to_continue`. For a new topic awaiting confirmation, save the proposed scope, section order, materials, and starting point or link to the draft outline; set active check to none and the resume action to obtaining confirmation. Record confirmation before beginning teaching, including when resuming in another thread.

For `ready_to_continue`, `Resume action` names the exact section, source pages/example, and teaching action; “continue the remaining examples” is insufficient. If an explanation pauses before that action, briefly name the upcoming topic. At a meaningful Test-or-continue branch, use `awaiting_choice` and save both the Test scope and continuation target. A displayed Check/question needs no extra next-action hint or competing menu. A new thread executes this saved action rather than repeating a completed question or guessing from a generic next-step label.

Tests use the same durable question/answer records and active-check pointer as Checks, with distinct IDs such as `T3-01-Q1`. See [TUTOR_TESTS.md](TUTOR_TESTS.md) for source history, evaluation, and resumption. A pending `awaiting_choice` contains no invented active question; preserve the actual options until the learner selects one.

The active check and current section override later-section plans. “Covered” means explained, not that its check was completed. Clear the active check only after answering/feedback is recorded and no response is outstanding, or the learner explicitly skips or defers it. Save a new follow-up with its own ID before making it active. Keep deferred checks as links, not competing next actions.

Persist the question in topic.md first, then its handoff/key, before ending the turn that asks it. After a response, persist the actual answer/assets first, then update the handoff. If a turn is interrupted between writes, reconcile state from the linked check: an unanswered check stays active; an answer without completed feedback must still be evaluated. Do not advance on the existence of an answer alone. If the prompt cannot be recovered from the saved evidence, ask for it instead of reconstructing it from the section title.

The question text has one authoritative home in topic.md. The workpad contains only the pointer, state, checked key, minimal source context needed to evaluate it, and relevant cache locations. Keep the key out of the unanswered question entry and out of status/resume replies. Workpad access supports evaluation; it is not permission to display answers. This file is not confidential; do not store private chain-of-thought.

## Fast source access and updates

Prepare source text and page images at startup using [FAST_IO.md](FAST_IO.md). Retain its manifest paths and the section-to-page map in the workpad. Reuse unchanged caches across threads, and preload current/next sections into context rather than reading a PDF or cached text on every reply. Existing legacy text caches remain usable.
A routine evaluation uses the active question and checked key. No PDF access is needed unless that context is incomplete, disputed, or stale. New lesson content uses the appropriate cached source pages. Never replace unavailable source content with guesses in the name of speed.

Use [FAST_IO.md](FAST_IO.md) for a single startup context read, then save only new content and changed handoff fields with the compact `save` operation in one call per response, prefetching upcoming pages in that same save when necessary. Its helper performs readback verification internally; a verified result needs no additional inspection command. Keep other notes and the directory untouched. Consolidate broader notes when a section ends or the learner asks, not after every answer.

When repairing an existing guide, preserve useful explanations and learner evidence. Recover pending questions from saved evidence into their topic section and link them from the handoff. Do not fabricate missing historical question wording or learner answers. Keep a backup before a substantial rewrite.
