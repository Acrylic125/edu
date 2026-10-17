# Topic files and source attribution

Each topic folder contains:

```text
topics/<topic-id>/
  topic.md
  topic.state.json
  assets/
```

`topic.md` is the conceptual summary: scope, key ideas, explanations, worked examples, terminology, and citations. It can contain a source directory, but that directory is curriculum, not evidence of completion. Preserve existing legacy notes as historical evidence. Revise the summary with `updateTopic`; exact questions, learner answers, progress, and mistakes belong in structured state.

`topic.state.json` has version `11-10-2026`, an ISO createdAt, name, ordered content parts, and a threadTutors array. Each part has a stable `tp-` id, optional parent part, name, references, a goal with a stable `tpg-` id, objective and understoodWhen criteria, and mistakes with context and issue. Each writer thread has an id and a progress map keyed by part id. Progress has active/completed status and ordered question steps with an optional answerFromUser. An absent answer means no answer was recorded. Read-only references do not create threadTutors.

Reference paths are relative to this JSON file. Use `assets/<filename>` for local PDF, PPT, and image assets. PDF/PPT pages are inclusive ranges `{from, to}` using 1-based file pages. Website references use an HTTP or HTTPS URL. Referenced supplied materials are registered and copied into the topic before its state commits, so the source remains readable in later chats. Use materialIds to select the intended source when attached filenames are ambiguous. Keep content in source order, parents before children, and preserve stable part and goal IDs on revision.

The StateService tools own structured writes. Chat workpads own checked answer keys and temporary session logistics. Legacy topic workpads are retained as evidence, not current progress. Never edit state files directly or write progress into the topic summary.

In chat, use `Sourced from: [Lecture.pdf, pg. 5-6](edu-material://<material-id>/5)`. For visual material, request visuals and embed the returned `prune-source://<material-id>/<page>` image. In summaries, use `[Lecture.pdf, pg. 5-6](<assets/Lecture.pdf#page=5>)`. Display the relevant material before its citation; a link alone is not a visible reference.
