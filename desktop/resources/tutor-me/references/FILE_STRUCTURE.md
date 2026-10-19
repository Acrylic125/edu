# Topic files and source attribution

```text
topics/<topic-id>/
  topic.md
  topic.state.json
  assets/
```

## Ownership

- `topic.md`: conceptual explanations, worked examples, terminology, and citations.
- `topic.state.json`: curriculum, references, mistakes, and each thread's progress and question history. Managed by StateService.
- Private chat handoff: checked keys and temporary session logistics.
- Legacy topic workpads: unused. Preserve existing files; do not read them to restore progress.

## Summary

- Follow [GUIDE_DOCUMENT_TEMPLATE.md](../assets/GUIDE_DOCUMENT_TEMPLATE.md).
- Fill explanations incrementally under the corresponding part headings.
- Preserve useful explanations, actual source examples, and legacy evidence during edits.
- Read existing notes before replacing them with `updateTopic.summary`.
- When a mistake exposes unclear teaching, clarify the conceptual explanation in place.
- Keep individual attempts and mistake logs in structured state.

## References

- Preserve source order, parents before children, and stable part and goal IDs.
- Local paths are relative to `topic.state.json`: `assets/<exact filename>`.
- Types: `pdf`, `ppt`, `image`, `text`, or `website`.
- Use `text` for plain text, Markdown, and source code. Example: `{"type":"text","path":"assets/Lecture 4 - Code used in lecture.txt"}`.
- PDF and PPT ranges are inclusive, 1-based `{from, to}`. Text and image references have no page ranges.
- Website references use actual HTTP or HTTPS URLs.
- Referenced supplied assets are copied and registered before commit.
- Use `materialIds` when source filenames are ambiguous.

## Citations

- Chat: `Sourced from: [Lecture.pdf, pg. 5-6](edu-material://<material-id>/5)`.
- Visual: request `includeVisuals=true`, then embed `![Description](prune-source://<material-id>/<page>)`.
- Summary: `[Lecture 4A.pdf, pg. 1-15](<assets/Lecture 4A - Pointers and Functions.pdf#page=1>)`.
- Text asset: `[Lecture 4 code.txt](<assets/Lecture 4 - Code used in lecture.txt>)`.
- Wrap every local Markdown destination in angle brackets, including Materials entries.
- Keep exact filenames in targets. Shorten labels while retaining lecture/part identifiers and extensions.
- Link every listed supplied material. Anchor PDFs to the first cited page.
- Directory JSON hrefs and structured paths stay plain `assets/<filename>` strings.
- Cite online sources with direct Markdown links.

## Topic directory

- Use exactly one `<topic-directory heading="Topic directory" items='[...]' />`.
- Follow curriculum hierarchy and source order with nested `children`.
- Entries have `title`, optional `anchor`, and `sources` containing `label` and `href`.
- Add an anchor only when notes exist. Leave uncovered entries unlinked.
- The directory shows curriculum, not progress.
- Use single-quoted JSON. Encode apostrophes inside it as `\u0027`.

### Directory example

```markdown
<topic-directory heading="Topic directory" items='[{"title":"1. Limits","anchor":"limits","sources":[{"label":"Lecture 1.pdf, pg. 2-4","href":"assets/Lecture 1.pdf#page=2"}],"children":[{"title":"1.1 One-sided limits"}]}]' />

<a id="limits"></a>
## 1. Limits

{Conceptual explanation of the material discussed so far.}
```

### Directory with section sources

```markdown
<topic-directory heading="Topic directory" items='[{"title":"2. Arrays","anchor":"arrays","sources":[{"label":"Lecture 5A.pdf, pg. 5-6","href":"assets/Lecture 5A - Arrays.pdf#page=5"}],"children":[{"title":"2.1 Array Declaration","sources":[{"label":"Lecture 5A.pdf, pg. 7","href":"assets/Lecture 5A - Arrays.pdf#page=7"}]}]}]' />
```
