import type { z } from "zod"
import type { TopicDirectoryEntrySchema } from "../shared/topic-directory"
import type { Snapshot } from "../shared/contracts"
import { resolveMaterialLink } from "../shared/material-links"

function Entries({
  entries,
  currentSection,
  materials,
  onOpenMaterial,
}: {
  entries: z.infer<typeof TopicDirectoryEntrySchema>[]
  currentSection: string
  materials: Snapshot["topics"][number]["materials"]
  onOpenMaterial?: (id: string) => void
}) {
  return (
    <ul className="space-y-1.5">
      {entries.map((entry, index) => (
        <li key={`${index}-${entry.title}`} className="text-sm leading-snug">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {entry.anchor ? (
              <button
                type="button"
                aria-current={entry.title === currentSection ? "step" : undefined}
                className="rounded-md text-left font-medium text-foreground underline-offset-4 hover:underline aria-[current=step]:text-primary"
                onClick={(event) => {
                  const headings =
                    event.currentTarget
                      .closest(".study-document")
                      ?.querySelectorAll("h1, h2, h3, h4") ?? []
                  Array.from(headings)
                    .find((heading) => heading.id === entry.anchor || heading.textContent?.trim() === entry.title)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
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
              const material = resolveMaterialLink(source.href, materials)
              if (material && onOpenMaterial) {
                return <a
                  key={`${source.label}-${source.href}`}
                  href={`edu-material://${material.id}/${material.page}`}
                  className="rounded-md bg-learning-circle px-1.5 py-0.5 text-xs text-muted-foreground hover:underline"
                  onClick={(event) => { event.preventDefault(); onOpenMaterial(material.id) }}
                >{source.label}</a>
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
              <Entries entries={entry.children} currentSection={currentSection} materials={materials} onOpenMaterial={onOpenMaterial} />
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
  currentSection,
  materials = [],
  onOpenMaterial,
}: {
  heading: string
  items: z.infer<typeof TopicDirectoryEntrySchema>[]
  currentSection: string
  materials?: Snapshot["topics"][number]["materials"]
  onOpenMaterial?: (id: string) => void
}) {
  return (
    <nav
      className="my-8 rounded-[1.5rem] bg-learning-sage/50 px-6 py-6"
      aria-label={heading}
    >
      <h2 className="mb-3 text-base font-semibold">{heading}</h2>
      <Entries entries={items} currentSection={currentSection} materials={materials} onOpenMaterial={onOpenMaterial} />
    </nav>
  )
}
