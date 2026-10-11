# Prepare once, preload, then save

Local cached text is cheap to read. Repeated model/tool round trips to discover paths, read pages, edit notes, inspect them, and edit again are not. Use the bundled helper for existing topics instead of composing that sequence anew.

## Prepare at session startup

Run this once before teaching from supplied PDFs (for a new topic, during plan preparation). It caches all supplied lecture PDFs together as page-separated text and ready-to-display PNGs:

```bash
python3 /path/to/tutor-me/scripts/prepare_sources.py --topic /path/to/topic
```

By default it finds PDFs under `assets/`; use repeatable `--pdf /absolute/source.pdf` for materials linked elsewhere. Requires Poppler's `pdftotext` and `pdftoppm`. It processes up to four documents concurrently, writes under `assets/cache/prepared/`, and reports each manifest's path. Text and image paths in a manifest are relative to its directory; page numbers are 1-based. Existing legacy text caches remain untouched. Store manifest locations and the section-to-page map in the workpad during the ordinary startup save.

On a fresh thread, this command checks source size/mtime and cached outputs, reusing unchanged caches. Rebuild only changed or incomplete sources. Run again within the same thread only when materials change or a cache is missing. For a very large collection, prepare the selected lesson's PDFs first using `--pdf`, then prepare later documents at a lesson boundary. Image-only pages are flagged: inspect their rendered images, and use OCR if necessary rather than guessing from empty text. Raise `--dpi` only if needed for legibility. Cached rendering does not replace visually reading a diagram before teaching it.

**A disk cache is not conversation context.** After preparation, preload the current and next source section, their complete related code files, and the active Check/key in one read. For a short lecture, load the whole text with `--pages all` when it comfortably fits; for a long lecture use a bounded section range. Inspect relevant cached visuals together at this point. Read the saved handoff to choose the current section; preloading later material never marks it taught or resolves an active Check. New-topic teaching still waits for plan confirmation.

## Same-thread answer path

Use the question, checked key, and source content already in context to respond directly. The normal path is **zero read commands and one verified save**. Keep returned hashes and source excerpts in context. When upcoming material is needed for the prepared continuation, attach its cached page range/code paths to the existing `save` command; the helper returns them as `prefetch` alongside save verification. Thus the next Check starts with its sources already loaded. Prefetch is not an instruction to analyse future sections after giving feedback; substantial lesson preparation belongs to a lesson turn. Prefetch only material not already in context, maintaining a current-plus-next-section window. Inspect a newly needed visual before discussing it; reuse its cached image instead of rendering again.

A new thread, context compaction that lost the source excerpt/hashes, disputed or missing source detail, or changed files can require one combined read. Do not reread notes to reacquire hashes already returned by the last save. Do not read source pages merely because a correct answer advances to a section already preloaded. Required persistence of every Check, answer, and handoff remains unchanged.

### Overlap bookkeeping with teaching

When the learner has authorised background bookkeeping and delegation tools are available, use one bookkeeping subagent for the topic. Reuse the same-thread helper with `followup_task` when available rather than spawning a fresh agent per answer. This is parallel work within the active turn; do not promise durable work after the final message or a particular latency improvement. A direct minimal save remains preferable when delegation is unavailable or the task is too small to offer useful overlap.

Dispatch a compact task containing the topic path, question anchor, exact learner answer or submission pointer, settled verdict/correction, and current file hashes. Use the minimum needed context/fork when spawning; full lesson history is unnecessary. Supply any finalised teaching, next-question wording, checked key, and next action that must be recorded; reference already supplied content instead of writing a second full JSON payload. The subagent converts these settled facts into the existing `save` format. It may compose concise notes from supplied teaching, but assessment, checked keys, question design, and lesson decisions remain with the main tutor. It reads only missing context or a concrete conflict, rather than rereading already supplied sources or reviewing the settled verdict.

The bookkeeping subagent is the sole writer of `topic.md` and `agent.workpad.md` during its task. Serialize its requests and keep main-tutor writes out of that interval. While it prepares the record, the main tutor prepares the selected next action and, when the lesson continues, starts the prepared explanation in commentary. A checkpoint choice, remaining question, or pause does not start a new lesson. If teaching or the next question is still being finalised, instruct the subagent to hold the commit; send the exact new content and handoff changes when ready, then request one combined verified save where possible. Record only material actually taught and progress actually evidenced, leaving future preparation as a draft. Keep pending keys out of learner-facing messages and question notes.

Before ending the turn or relying on newly saved state, obtain the subagent's verified save result and both updated hashes, plus needed prefetch output. If it is slow or fails, name the specific pending operation and keep the save status accurate. Before retrying a failed or interrupted write, establish that the helper has stopped writing and reconcile both files using the verification rules below; preserve existing answers rather than appending duplicates.

## Read the packet once

Run `scripts/tutor_io.py` relative to the installed skill directory, using its actual absolute path in the command:

```bash
python3 /path/to/tutor-me/scripts/tutor_io.py read --topic /path/to/topic
```

It returns the workpad, the exact active-check excerpt, and the SHA-256 of each notes file. Retain those hashes until the next save. On a same-thread turn, successful save output supplies the new hashes; there is no need to read the files again just to obtain them.

At startup/resume, include current and upcoming cached pages and any needed source code in that same call:

```bash
python3 /path/to/tutor-me/scripts/tutor_io.py read --topic /path/to/topic \
  --source 'assets/cache/Lecture 5A - Arrays, Strings and Structures.txt' \
  --pages 9-10 --file 'assets/ArrayCopy.c'
```

Use actual paths from the workpad or a single initial inventory; cache location is not assumed. `--anchor section-id` selects a known note section instead of the active check. An absent anchor is reported rather than replaced with an unrelated excerpt. Do not request new source pages for a routine answer evaluation. Existing context remains valid unless changed or insufficient.

## Save only new content

Use `save` for routine tutoring. The helper locates anchors, appends answers/notes, formats question entries, and changes named handoff fields. Supply only new content; do not regenerate the old paragraph, repeated progress summaries, unchanged keys, or the full workpad. For a correct, uncontested answer, normally supply `answers` and only the handoff changes needed to represent the selected next action. Keep the existing `Current section` and `After resolution` when still accurate; put a brief evidence qualifier in `Last completed check` if necessary. Add `notes` for new teaching or a useful new takeaway, rather than duplicating the verdict or learner's reasoning. The model still decides the assessment and next teaching action. The helper does not judge correctness or learner mastery.

For example, a correct answer followed by a meaningful checkpoint choice needs:

```bash
python3 /path/to/tutor-me/scripts/tutor_io.py save --topic /path/to/topic <<'JSON'
{
  "expected": {"topic.md": "latest topic hash", "agent.workpad.md": "latest workpad hash"},
  "answers": [{"anchor": "check-c1-01", "text": "The instruction does the same thing; clock speed can differ."}],
  "handoff": {
    "Phase": "awaiting_choice",
    "Last completed check": "C1-01",
    "Resume action": "Offer a quick Test of ISA vs implementation, or continue to the execution walkthrough, pp. 9-14."
  }
}
JSON
```

Keep both hashes from the last read or successful save. The helper rejects stale files before writing. A quoted heredoc prevents shell interpretation; choose a delimiter absent from the payload and encode JSON strings correctly. `save` expects existing `topic.md` and `agent.workpad.md`; create the initial topic from the template during startup.

### Available changes

Combine needed changes in the same request; omit unused categories:

- `answers`: each entry has the existing question `anchor` and the learner's exact `text`. It appends an answer, preserving the prompt and earlier attempts. For an image/file-only submission, use `text: ""` with nonempty `assets`; do not invent learner text. For solution files, first preserve the originals under `assets/answers/<check-id>/`, then include `assets: [{"path": "assets/answers/C1-01/solution.png", "label": "Learner solution"}]`. Existing images are embedded and files linked. Copy attachments in the same tool invocation when needed. For a wrong learner/tutor answer or contention, include concise `deliberation` and `reason` (`learner_error`, `tutor_error`, or `contention`). Omit both for correct uncontested answers; missing reasoning alone is not an error.
- `notes`: use `{"anchor": "section-anchor", "append": "New explanation or learning takeaway in Markdown."}`. Write the explanation once, keeping unchanged notes untouched. To create a newly taught section, provide a new `anchor`, `heading` (for example `"## 2.4 Array Parameters"`), and `append`. New sections are inserted before `## Materials` or at the end if it is absent. Choose the next confirmed source section; arbitrary restructuring still uses a targeted repair.
- `questions`: add one new Check, Test item, or follow-up with `id`, unique `anchor`, existing `section` anchor, full self-contained `prompt` in Markdown (including code/assets/provenance), and concise checked `key`. The helper appends the question under that section and automatically sets `Active check`, `Phase: awaiting_answer`, and the active workpad key. The key is not put in topic.md. A section created by `notes` in this request can hold the question. Do not include the answer in `prompt`.
- `handoff`: supply only changed fields from `Current section`, `Phase`, `Active check`, `Last completed check`, `Resume action`, and `After resolution`. Name the concrete next teaching action, remaining question, or both branches of a choice. For `ready_to_continue` or `awaiting_choice`, the helper clears the old active pointer; completion remains your explicit judgement. For an incomplete answer, keep `awaiting_answer` and the same active question, or add the self-contained follow-up through `questions`. An answer does not automatically complete a question. Preserve unrelated source/cache metadata and the confirmed plan.

Prepare the successful-answer explanation outline or exact checkpoint choice in `After resolution` when saving the question, following SKILL.md. Reuse it when the answer arrives. After giving the verdict, use the overlap procedure above when applicable; otherwise issue the minimal save and deliver the prepared action directly after verified success. A compact save is persistence, not a learner-facing response: continue teaching, show the remaining question, or offer the meaningful choice according to SKILL.md. Status/resume replies still exclude pending keys. Ask for new-topic plan confirmation and preserve that pending state exactly as before.

### Prefetch and verification

Add `--source 'assets/cache/prepared/<document>/pages.txt' --pages 11-15 --file 'assets/code/ArraySumFunction.c'` to the same `save` command when upcoming source context is actually needed. The helper preflights these inputs before writing and returns them in `prefetch`. Use actual paths and ranges; legacy page-separated `.txt` caches also work. `--file` is repeatable; `--pages all` is for appropriately sized sources.

The helper preflights all changes, saves notes before handoff, verifies saved bytes internally, and returns both hashes without echoing the answer key. A successful verified save ends routine verification. Re-read only after a reported failure, concurrent edit, lost context, or concrete inconsistency. If a save partially fails, reconcile both files before retrying; do not blindly duplicate the answer.

### Existing-topic repairs

The legacy `apply` operation remains available for an actual correction to existing notes, source-map edits, or malformed state that the compact operations cannot express. It accepts `files` with `expected_sha256` and unique exact `old`/`new` replacements; full `content` is supported only for the workpad. Use the current hashes, modify only necessary text, and preserve learner evidence. This is an escape hatch, not the normal answer path.

This change reduces model-generated edit text and repeated tool round trips. It does not guarantee a particular response time; do not replace required teaching, records, or source fidelity with brevity.
