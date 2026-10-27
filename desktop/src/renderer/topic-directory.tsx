import { useMemo } from "react"
import { markdownHeadings } from "./section-anchors"
import type { z } from "zod"
import type { TopicDirectoryEntrySchema } from "../shared/topic-directory"
import type { Snapshot } from "../shared/contracts"
import { materialReferenceLabel, resolveMaterialLink } from "../shared/material-links"

function Entries({
  entries,
  targets,
  currentSection,
  materials,
  labelMaterials,
  onOpenMaterial,
  scratchpads,
  onOpenScratchpad,
}: {
  entries: z.infer<typeof TopicDirectoryEntrySchema>[]
  targets: Map<z.infer<typeof TopicDirectoryEntrySchema>, number>
  currentSection: string
  materials: Snapshot["scratchpads"][number]["materials"]
  labelMaterials: Snapshot["scratchpads"][number]["materials"]
  onOpenMaterial?: (id: string) => void
  scratchpads: Snapshot["scratchpads"]
  onOpenScratchpad?: (id: string) => void
}) {
  return (
    <ul className="space-y-1.5">
      {entries.map((entry, index) => (
        <li key={`${index}-${entry.title}`} className="text-sm leading-snug">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {targets.has(entry) ? (
              <button
                type="button"
                aria-current={entry.title === currentSection ? "step" : undefined}
                className="rounded-md text-left font-medium text-foreground underline-offset-4 hover:underline aria-[current=step]:text-primary"
                onClick={(event) => {
                  const headings = event.currentTarget.closest(".study-document")
                    ?.querySelectorAll(".markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6")
                  const index = targets.get(entry)
                  if (index !== undefined) headings?.[index]?.scrollIntoView({ behavior: "smooth", block: "start" })
                }}
              >
                {entry.title}
              </button>
            ) : (
              <span
                aria-current={entry.title === currentSection ? "step" : undefined}
                className="text-muted-foreground aria-[current=step]:font-medium aria-[current=step]:text-foreground"
              >
                {entry.title}
              </span>
            )}
            {entry.sources.map((source) => {
              const scratchpad = scratchpads.find((scratchpad) => source.href === `edu-topic://${scratchpad.id}`)
              if (scratchpad && onOpenScratchpad) {
                return <a
                  key={`${source.label}-${source.href}`}
                  href={source.href}
                  className="rounded-md bg-learning-circle px-1.5 py-0.5 text-xs text-muted-foreground hover:underline"
                  onClick={(event) => { event.preventDefault(); onOpenScratchpad(scratchpad.id) }}
                >@{scratchpad.title}</a>
              }
              if (/^https?:\/\//.test(source.href)) {
                return <a
                  key={`${source.label}-${source.href}`}
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md bg-learning-circle px-1.5 py-0.5 text-xs text-muted-foreground hover:underline"
                >{source.label}</a>
              }
              const material = resolveMaterialLink(source.href, materials)
              if (material && onOpenMaterial) {
                const file = materials.find((item) => item.id === material.id)!
                return <a
                  key={`${source.label}-${source.href}`}
                  href={`edu-material://${material.id}/${material.page}`}
                  title={file.name}
                  className="max-w-full truncate rounded-md bg-learning-circle px-1.5 py-0.5 text-xs text-muted-foreground hover:underline"
                  onClick={(event) => { event.preventDefault(); onOpenMaterial(material.id) }}
                >{materialReferenceLabel(source.label, file, labelMaterials)}</a>
              }
              return <span
                key={`${source.label}-${source.href}`}
                title={source.href}
                className="rounded-md bg-learning-circle px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {source.label}
              </span>
            })}
          </div>
          {entry.children.length > 0 && (
            <div className="mt-1.5 pl-5">
              <Entries targets={targets} entries={entry.children} currentSection={currentSection} materials={materials} labelMaterials={labelMaterials} onOpenMaterial={onOpenMaterial} scratchpads={scratchpads} onOpenScratchpad={onOpenScratchpad} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export function TopicDirectory({
  heading,
  items,
  markdown = [],
  currentSection,
  materials = [],
  labelMaterials = materials,
  onOpenMaterial,
  scratchpads = [],
  onOpenScratchpad,
}: {
  heading: string
  markdown?: string[]
  items: z.infer<typeof TopicDirectoryEntrySchema>[]
  currentSection: string
  materials?: Snapshot["scratchpads"][number]["materials"]
  labelMaterials?: Snapshot["scratchpads"][number]["materials"]
  onOpenMaterial?: (id: string) => void
  scratchpads?: Snapshot["scratchpads"]
  onOpenScratchpad?: (id: string) => void
}) {
  const targets = useMemo(() => {
    const headings = markdownHeadings(markdown)
    const resolved = new Map<z.infer<typeof TopicDirectoryEntrySchema>, number>()
    const used = new Set<number>()
    function normalized(title: string) {
      return title.normalize("NFKC").toLowerCase()
        .replace(/^\s*(?:section\s+)?\d+(?:\.\d+)*[.)]?\s+/i, "")
        .replace(/\s*\(?\b(?:pp?|pg|pages?)\.?\s*\d+(?:\s*[-–—]\s*\d+)?\)?\s*$/i, "")
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    }
    function resolve(entries: z.infer<typeof TopicDirectoryEntrySchema>[]) {
      for (const entry of entries) {
        let index = -1
        if (entry.anchor) index = headings.findIndex((heading) => heading.id === entry.anchor)
        if (index < 0) index = headings.findIndex((heading, candidate) => !used.has(candidate) && heading.title.trim() === entry.title.trim())
        if (index < 0) index = headings.findIndex((heading, candidate) => !used.has(candidate) && normalized(heading.title) === normalized(entry.title))
        if (index >= 0) {
          resolved.set(entry, index)
          used.add(index)
        }
        resolve(entry.children)
      }
    }
    resolve(items)
    return resolved
  }, [items, markdown])
  return (
    <nav
      className="my-8 rounded-[1.5rem] bg-learning-sage/50 px-6 py-6"
      aria-label={heading}
    >
      <h2 className="mb-3 text-base font-semibold">{heading}</h2>
      <Entries targets={targets} entries={items} currentSection={currentSection} materials={materials} labelMaterials={labelMaterials} onOpenMaterial={onOpenMaterial} scratchpads={scratchpads} onOpenScratchpad={onOpenScratchpad} />
    </nav>
  )
}
