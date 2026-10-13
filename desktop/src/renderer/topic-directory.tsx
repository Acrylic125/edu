import type { z } from "zod"
import type { TopicDirectoryEntrySchema } from "../shared/topic-directory"

function Entries({
  entries,
  currentSection,
}: {
  entries: z.infer<typeof TopicDirectoryEntrySchema>[]
  currentSection: string
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
                  // Raw HTML anchors are not rendered, so locate the section by its heading text.
                  const headings =
                    event.currentTarget
                      .closest(".study-document")
                      ?.querySelectorAll("h1, h2, h3, h4") ?? []
                  Array.from(headings)
                    .find((heading) => heading.textContent?.trim() === entry.title)
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
            {entry.sources.map((source) => (
              <span
                key={`${source.label}-${source.href}`}
                title={source.href}
                className="rounded-md bg-learning-circle px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {source.label}
              </span>
            ))}
          </div>
          {entry.children.length > 0 && (
            <div className="mt-1.5 pl-5">
              <Entries entries={entry.children} currentSection={currentSection} />
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
}: {
  heading: string
  items: z.infer<typeof TopicDirectoryEntrySchema>[]
  currentSection: string
}) {
  return (
    <nav
      className="my-8 rounded-[1.5rem] bg-learning-sage/50 px-6 py-6"
      aria-label={heading}
    >
      <h2 className="mb-3 text-base font-semibold">{heading}</h2>
      <Entries entries={items} currentSection={currentSection} />
    </nav>
  )
}
