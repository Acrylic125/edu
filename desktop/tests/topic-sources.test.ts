import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import { TopicDirectory } from "../src/renderer/topic-directory"
import { topicSourceMaterials } from "../src/shared/material-links"
import { newChat, newTopic } from "../src/main/workspace"
import { StudyMarkdown } from "../src/renderer/markdown"

vi.mock("../src/renderer/mermaid-diagram", () => ({ MermaidDiagram: () => null }))

test("topic citations include refreshed attachments from its earlier chat", () => {
  const topic = newTopic("Datapath")
  const chat = newChat("12345678-1234-4234-8234-123456789abc")
  const material = { id: "22345678-1234-4234-8234-123456789abc", name: "Refreshed lecture.pdf", kind: "pdf" as const, text: "Datapath", pages: ["Datapath"] }
  chat.materials.push(material)
  chat.messages.push({ id: "32345678-1234-4234-8234-123456789abc", role: "user", content: "Read the refreshed PDF", topicIds: [topic.id], createdAt: new Date().toISOString() })
  const unrelated = newChat(chat.runnerId)
  unrelated.materials.push({ ...material, id: "42345678-1234-4234-8234-123456789abc" })
  const materials = topicSourceMaterials(topic, [chat, unrelated].map((chat) => ({ ...chat, phase: chat.learning.phase })))
  expect(materials).toEqual([material])
  const html = renderToStaticMarkup(createElement(StudyMarkdown, {
    text: `[Lecture PDF](edu-material://${material.id}/1)`, materials, onOpenMaterial: vi.fn(),
  }))
  expect(html).toContain(`<a href="edu-material://${material.id}/1"`)
})

test("directory source citations open the known material", () => {
  const material = { id: "12345678-1234-4234-8234-123456789abc", name: "Lecture 11.pdf", kind: "pdf" as const }
  const html = renderToStaticMarkup(createElement(TopicDirectory, {
    heading: "Topic directory",
    items: [{ title: "1. Datapath", anchor: "datapath", children: [], sources: [{ label: "Lecture 11.pdf, pg. 5", href: "assets/Lecture 11.pdf#page=5" }] }],
    currentSection: "1. Datapath",
    materials: [material],
    onOpenMaterial: vi.fn(),
  }))
  expect(html).toContain(`<a href="edu-material://${material.id}/5"`)
})

test("directory website references render as actionable source links", () => {
  const href = "https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function"
  const html = renderToStaticMarkup(createElement(TopicDirectory, {
    heading: "Topic directory", currentSection: "",
    items: [{ title: "Limits", children: [], sources: [{ label: "OpenStax limits", href }] }],
  }))
  expect(html).toContain(`<a href="${href}"`)
  expect(html).toContain('target="_blank"')
})

test("directory scratchpad references open their target instead of remaining labels", () => {
  const topic = newTopic("Prerequisite algebra")
  const href = `edu-topic://${topic.id}`
  const html = renderToStaticMarkup(createElement(TopicDirectory, {
    heading: "Topic directory", currentSection: "", topics: [topic], onOpenTopic: vi.fn(),
    items: [{ title: "Limits", children: [], sources: [{ label: "Related topic", href }] }],
  }))
  expect(html).toContain(`<a href="${href}"`)
  expect(html).toContain("Prerequisite algebra")
})
