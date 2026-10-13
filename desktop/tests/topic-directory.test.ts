import { expect, test } from "vitest"
import {
  parseTopicDirectory,
  topicDirectoryFormat,
  topicDirectoryMarkdown,
  validateTopicDirectory,
} from "../src/shared/topic-directory"

const notes = `Scope.

<topic-directory heading="Topic directory" items='[{"title":"2. Newton\\u0027s laws","anchor":"newton","sources":[{"label":"Lecture 1.pdf, pg. 2","href":"assets/Lecture 1.pdf#page=2"}],"children":[{"title":"2.1 Inertia"}]}]' />

## 2. Newton's laws`

test("splits notes around a valid topic directory", () => {
  const parsed = parseTopicDirectory(notes)
  expect(parsed.before).toBe("Scope.\n\n")
  expect(parsed.after).toBe("\n\n## 2. Newton's laws")
  expect(parsed.directory).toEqual({
    heading: "Topic directory",
    items: [
      {
        title: "2. Newton's laws",
        anchor: "newton",
        sources: [
          { label: "Lecture 1.pdf, pg. 2", href: "assets/Lecture 1.pdf#page=2" },
        ],
        children: [{ title: "2.1 Inertia", sources: [], children: [] }],
      },
    ],
  })
})

test("the instructed example format is valid", () => {
  expect(() => validateTopicDirectory(topicDirectoryFormat)).not.toThrow()
})

test("rejects missing, markdown, malformed, and duplicate directories", () => {
  expect(() => validateTopicDirectory("Scope.")).toThrow("one topic directory element")
  expect(() =>
    validateTopicDirectory(`## Topic directory\n\n${topicDirectoryFormat}`),
  ).toThrow('markdown "Topic directory"')
  expect(() =>
    validateTopicDirectory(`<topic-directory heading="Topic directory" items='[{"title":}]' />`),
  ).toThrow("valid JSON")
  expect(() =>
    validateTopicDirectory(`<topic-directory heading="Topic directory" items='[]' />`),
  ).toThrow("Invalid topic directory")
  expect(() =>
    validateTopicDirectory(`${topicDirectoryFormat}\n${topicDirectoryFormat}`),
  ).toThrow("only one")
})

test("exports the directory as the skill's markdown list", () => {
  expect(topicDirectoryMarkdown(notes)).toBe(`Scope.

## Topic directory

- [2. Newton's laws](#newton) [Lecture 1.pdf, pg. 2](<assets/Lecture 1.pdf#page=2>)
  - 2.1 Inertia

## 2. Newton's laws`)
})
