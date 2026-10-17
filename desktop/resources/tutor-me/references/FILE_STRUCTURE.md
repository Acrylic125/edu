# Topic files and source attribution

Each topic folder contains:

```text
topics/<topic-id>/
  topic.md
  topic.state.json
  assets/
```

`topic.md` is the conceptual summary: scope, key ideas, explanations, worked examples, terminology, and citations. Follow the summary template: title, one special `<topic-directory />` element, taught topic-part explanations, Topic terminology, and Materials. The directory describes curriculum, not evidence of completion. Fill gaps incrementally as teaching proceeds; clarify the relevant conceptual phrasing when mistakes reveal ambiguity. Keep useful explanations and source examples together under their topic-part heading. Preserve existing legacy notes as historical evidence. Revise the summary with `updateTopic`; exact questions, learner answers, progress, and mistakes belong in structured state.

`topic.state.json` has version `11-10-2026`, an ISO createdAt, name, ordered content parts, and a threadTutors array. Each part has a stable `tp-` id, optional parent part, name, references, a goal with a stable `tpg-` id, objective and understoodWhen criteria, and mistakes with context and issue. Each writer thread has an id and a progress map keyed by part id. Progress has active/covered/completed status (`covered` means the walkthrough finished with mastery unverified; `completed` means all goals were verified) and ordered question steps with an optional answerFromUser. An absent answer means no answer was recorded. Read-only references do not create threadTutors.

Reference paths are relative to this JSON file. Use `assets/<filename>` for local PDF, PPT, and image assets. PDF/PPT pages are inclusive ranges `{from, to}` using 1-based file pages. Website references use an HTTP or HTTPS URL. Referenced supplied materials are registered and copied into the topic before its state commits, so the source remains readable in later chats. Use materialIds to select the intended source when attached filenames are ambiguous. Keep content in source order, parents before children, and preserve stable part and goal IDs on revision.

The StateService tools own structured writes. Chat workpads own checked answer keys and temporary session logistics. Per-topic `topic.workpad.md` and `agent.workpad.md` files are unused and are neither read nor written. Existing files can remain on disk; they cannot direct teaching or restore progress. Never edit state files directly or write progress into the topic summary.

In chat, use `Sourced from: [Lecture.pdf, pg. 5-6](edu-material://<material-id>/5)`. For visual material, request visuals and embed the returned `prune-source://<material-id>/<page>` image. In summaries, including Materials, wrap every local Markdown link destination in angle brackets: `[Lecture 4A.pdf, pg. 1-15](<assets/Lecture 4A - Pointers and Functions.pdf#page=1>)`. The brackets keep spaces and parentheses in exact filenames valid Markdown. Link every listed supplied material, including text files, as `[Lecture 4 code.txt](<assets/Lecture 4 - Code used in lecture.txt>)`. Before submitting updateTopic.summary, check that every Materials entry links its exact supplied asset and every local Markdown destination uses `(<assets/...>)`. Directory JSON hrefs and structured reference paths remain plain `assets/<filename>` strings. Display the relevant material before its citation; a link alone is not a visible reference.

## Topic directory

Use exactly one `<topic-directory heading="Topic directory" items='[...]' />` element in place of a Markdown directory heading. The `items` value is single-quoted JSON; encode apostrophes within it as `\u0027`. Each entry has `title`, optional `anchor`, `sources` with `label` and `href`, and nested `children`. Follow the source hierarchy and section order. Add a stable anchor only when the corresponding notes exist; leave uncovered entries unlinked. This directory carries no active/completed state.

```markdown
<topic-directory heading="Topic directory" items='[{"title":"1. Limits","anchor":"limits","sources":[{"label":"Lecture 1.pdf, pg. 2-4","href":"assets/Lecture 1.pdf#page=2"}],"children":[{"title":"1.1 One-sided limits"}]}]' />

<a id="limits"></a>
## 1. Limits

{Conceptual explanation of the material discussed so far.}
```

Shorten citation labels semantically, retaining the lecture/part identifier and extension; keep the exact supplied filename in the link target. Cite page ranges and anchor PDF links to their first 1-based page. Use a `Sourced from:` line after the explanation. Materials lists original assets and relevant page ranges. Assessment records and session logistics do not belong in Materials or the directory.
