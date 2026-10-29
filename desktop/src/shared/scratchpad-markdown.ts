import { z } from "zod"
import type { Topic } from "./contracts"
import { ScratchpadStateSchema } from "./scratchpad-state"
import { materialCitationNames } from "./material-links"
import type { TopicDirectoryEntrySchema } from "./topic-directory"
import { ContentBlockSchema } from "./content-document"
import { normalizeMermaidMarkdown } from "./mermaid-markdown"

function separateMarkdownTables(markdown: string) {
  const lines = markdown.split("\n")
  const output: string[] = []
  let inCodeFence = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*(```|~~~)/.test(line)) inCodeFence = !inCodeFence

    const nextLine = lines[index + 1]
    const isTableHeader = !inCodeFence && /^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(nextLine ?? "")
    if (isTableHeader && output.length && output.at(-1)?.trim()) output.push("")
    output.push(line)

    if (isTableHeader) {
      while (index + 1 < lines.length && /^\s*\|/.test(lines[index + 1])) {
        index += 1
        output.push(lines[index])
      }
      if (index + 1 < lines.length && lines[index + 1].trim()) output.push("")
    }
  }

  return output.join("\n")
}

export function renderContentBlock(block: z.infer<typeof ContentBlockSchema>, materials: Topic["materials"]) {
  if (block.type === "markdown") return separateMarkdownTables(normalizeMermaidMarkdown(block.content.join("\n")))
  if (block.type === "term") return `**${block.term}:** ${block.meaning}`
  const material = materials.find((material) => material.id === block.materialId)
  if (!material) throw new Error(`Content source not found: ${block.materialId}`)
  if (block.page > (material.pages.length || 1)) throw new Error(`Content source page is outside ${material.name}.`)
  const label = `${material.name.replace(/[\[\]\\]/g, "\\$&")}, p. ${block.page}`
  if (block.presentation === "image") return `![${label}](edu-source://${material.id}/${block.page})`
  return `[${label}](edu-material://${material.id}/${block.page})`
}

export function scratchpadMarkdown(state: z.infer<typeof ScratchpadStateSchema>, materials: Topic["materials"]) {
  if (state.type === "generic") throw new Error("Generic scratchpads own their Markdown directly.")
  const blocks = state.document?.blocks ?? []
  const taught = new Set(blocks.flatMap((block) => "sectionId" in block && block.sectionId ? [block.sectionId] : []))
  const entries = (parentId?: string): z.infer<typeof TopicDirectoryEntrySchema>[] => state.content
    .filter((part) => part.parent?.id === parentId).map((part) => ({
      title: part.name,
      ...(taught.has(part.id) && { anchor: part.id }),
      sources: part.references.map((reference) => {
        if (reference.type === "website") return { label: reference.url, href: reference.url }
        if (reference.type === "topic") return { label: "Related topic", href: `edu-topic://${reference.id}` }
        const filename = reference.path.split("/").at(-1) ?? reference.path
        const label = materialCitationNames(filename).at(-1) ?? filename
        if (reference.type !== "pdf" && reference.type !== "ppt") return { label, href: reference.path }
        const pages = reference.pages.map(({ from, to }) => from === to ? `${from}` : `${from}-${to}`).join(", ")
        return { label: `${label}, pg. ${pages}`, href: `${reference.path}#page=${reference.pages[0].from}` }
      }),
      children: entries(part.id),
    }))
  const output = [`# ${state.name}`]
  let items = entries()
  if (!items.length && state.type === "topic") items = [{ title: state.name, sources: [], children: [] }]
  if (items.length) output.push(`<topic-directory heading="Topic directory" items='${JSON.stringify(items).replaceAll("'", "\\u0027")}' />`)
  const rendered = new Set<string>()
  const ordered = state.content.flatMap((part) => blocks.filter((block) => "sectionId" in block && block.sectionId === part.id))
  const unscoped = blocks.filter((block) => !("sectionId" in block) || !block.sectionId)
  for (const block of [...unscoped, ...ordered]) {
    if (block.type === "term") continue
    if (block.sectionId && !rendered.has(block.sectionId)) {
      const part = state.content.find((part) => part.id === block.sectionId)
      if (!part) throw new Error(`Content section not found: ${block.sectionId}`)
      output.push(`<a id="${part.id}"></a>\n\n## ${part.name}`)
      rendered.add(part.id)
    }
    output.push(renderContentBlock(block, materials))
  }
  if (state.type === "test") {
    for (const question of state.questions) {
      let text = `## ${question.title}\n${question.question}`
      if (question.answer !== undefined) text += `\n\n### You answered\n${question.answer}`
      output.push(text)
    }
  }
  const terms = blocks.filter((block) => block.type === "term")
  if (state.type === "topic" || terms.length) {
    const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", "<br />")
    output.push(`## Topic terminology\n\n| Term | Meaning |\n|---|---|${terms.map((term) => `\n| ${cell(term.term)} | ${cell(term.meaning)} |`).join("")}`)
  }
  return output.filter((text) => text.trim()).join("\n\n")
}
