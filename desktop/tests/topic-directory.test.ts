import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { TopicDirectory } from "../src/renderer/topic-directory"
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


test("directory distinguishes opaque files with compact labels and preserves page ranges", () => {
  const materials = [
    { id: "12345678-1234-4234-8234-123456789abc", name: "c3e312d6-5a40-42a6-893a-559bfa0fd7d9-pdf.pdf", kind: "pdf" as const },
    { id: "22345678-1234-4234-8234-123456789abc", name: "b29c1ab5-88d4-4a6a-988a-1ee55fafeb31-pdf.pdf", kind: "pdf" as const },
    { id: "32345678-1234-4234-8234-123456789abc", name: "c3e312d6-5a40-42a6-893a-559bfa0fd7d9-pptx.pptx", kind: "text" as const },
  ]
  const html = renderToStaticMarkup(createElement(TopicDirectory, {
    heading: "Topic directory",
    currentSection: "Registers",
    materials,
    onOpenMaterial: () => {},
    items: [{ title: "Registers", children: [], sources: materials.map((material) => ({
      label: `${material.name}, pg. 7-8`, href: `assets/${material.name}#page=7`,
    })) }],
  }))
  expect(html).toContain('>Document 1.pdf, pg. 7-8</a>')
  expect(html).toContain('>Document 2.pdf, pg. 7-8</a>')
  expect(html).toContain('>Slides.pptx, pg. 7-8</a>')
  expect(html).toContain(`href="edu-material://${materials[1].id}/7"`)
})
