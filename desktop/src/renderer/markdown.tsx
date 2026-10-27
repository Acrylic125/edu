import { Children, memo, createContext, useContext, useId, isValidElement, type ComponentProps, type ComponentPropsWithoutRef } from "react"
import Markdown, { defaultUrlTransform, type ExtraProps } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "rehype-highlight"
import { Tooltip } from "@base-ui/react/tooltip"
import "katex/dist/katex.min.css"
import { prepareVisualizationMarkdown, visualizationMarkdown } from "./visualization/markdown"
import { PlotlyVisualization } from "./visualization/plotly-visualization"
import { MermaidDiagram } from "./mermaid-diagram"
import { MediaPreview } from "./media-preview"
import { normalizeMathDelimiters } from "./normalize-math"
import { linkSourceCitations } from "./source-citations"
import { sourcePreviews } from "./source-previews"
import { materialReferenceLabel, resolveMaterialLink } from "../shared/material-links"
import { sectionAnchors } from "./section-anchors"
import { understandingChecks } from "./understanding-checks"
import { topicTerminology, type TopicTerm } from "./topic-terminology"
import { Check } from "lucide-react"
import type { Snapshot } from "../shared/contracts"

const VisualizationBlocks = createContext<ReturnType<typeof prepareVisualizationMarkdown>["blocks"]>([])
const UnderstandingCheckLabel = createContext("Check your understanding")
const Terminology = createContext<TopicTerm[]>([])

function MarkdownTerm({ node, children }: ComponentPropsWithoutRef<"mark"> & ExtraProps) {
  const terms = useContext(Terminology)
  const definitionId = useId()
  const term = terms.find((term) => term.id === node?.properties["data-term-id"])
  if (!term) return <mark>{children}</mark>
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<mark />}
        tabIndex={0}
        aria-describedby={definitionId}
        className="cursor-help rounded-sm bg-learning-sage/70 px-0.5 text-inherit decoration-learning-ink/40 underline decoration-dotted underline-offset-4 outline-none hover:bg-learning-sage focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={8} className="z-50">
          <Tooltip.Popup id={definitionId} role="tooltip" className="max-h-[min(24rem,var(--available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg">
            <p className="mb-2 font-semibold">{term.term}</p>
            <StudyMarkdown text={term.meaning} />
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

const MarkdownReferences = createContext<Pick<ComponentProps<typeof StudyMarkdown>,
  "scratchpads" | "materials" | "labelMaterials" | "onOpenScratchpad" | "onOpenMaterial"
>>({})

function VisualizationMarkdownDiv({ node, children }: ComponentPropsWithoutRef<"div"> & ExtraProps) {
  const blocks = useContext(VisualizationBlocks)
  const checkLabel = useContext(UnderstandingCheckLabel)
  const index = node?.properties["data-visualization-index"]
  if (typeof index === "number" && blocks[index]) {
    const block = blocks[index]
    return <PlotlyVisualization source={block.source} pending={block.pending} />
  }
  if (node?.properties["data-understanding-check"]) {
    return (
      <section aria-label={checkLabel} className="understanding-check rounded-xl bg-learning-sage p-3.5 text-learning-ink">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
          <Check aria-hidden="true" className="size-3.5 shrink-0" /> {checkLabel}
        </p>
        <div className="understanding-check-body">{children}</div>
      </section>
    )
  }
  return <div>{children}</div>
}

function MarkdownImage({ src, alt, title }: ComponentPropsWithoutRef<"img"> & ExtraProps) {
  const { materials = [] } = useContext(MarkdownReferences)
  const source = resolveMaterialLink(src ?? "", materials)
  if (source) src = `edu-source://${source.id}/${source.page}`
  return (
    <MediaPreview
      label={alt || "Image preview"}
      preview={<img src={src} alt={alt ?? ""} />}
    >
      {(open) => (
        <img
          src={src}
          alt={alt ?? ""}
          title={title || "Click to magnify"}
          role="button"
          tabIndex={0}
          aria-label={`Magnify ${alt || "image"}`}
          aria-haspopup="dialog"
          className="cursor-zoom-in rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={open}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              event.currentTarget.click()
            }
          }}
        />
      )}
    </MediaPreview>
  )
}

function MarkdownCode({ className, children }: ComponentPropsWithoutRef<"code"> & ExtraProps) {
  if (className?.split(" ").includes("language-mermaid")) {
    return <MermaidDiagram definition={String(children).trimEnd()} />
  }
  return <code className={className}>{children}</code>
}

function MarkdownPre({ children }: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
  if (
    isValidElement<{ className?: string }>(children) &&
    children.props.className?.split(" ").includes("language-mermaid")
  ) {
    return <div>{children}</div>
  }
  return <pre>{children}</pre>
}

function MarkdownLink({ href, children }: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  const { scratchpads = [], materials = [], labelMaterials = materials, onOpenMaterial, onOpenScratchpad } = useContext(MarkdownReferences)
  if (href?.startsWith("#")) {
    return (
      <a href={href} onClick={(event) => {
        event.preventDefault()
        const document = event.currentTarget.closest(".study-document") ?? event.currentTarget.closest(".markdown")
        Array.from(document?.querySelectorAll("[id]") ?? [])
          .find((element) => element.id === href.slice(1))
          ?.scrollIntoView({ behavior: "smooth", block: "start" })
      }}>{children}</a>
    )
  }
  const source = resolveMaterialLink(href ?? "", materials)
  if (source && onOpenMaterial) {
    const material = materials.find((item) => item.id === source.id)!
    const parts = Children.toArray(children)
    let label = children
    if (parts.every((part) => typeof part === "string")) {
      label = materialReferenceLabel(parts.join(""), material, labelMaterials)
    }
    return (
      <a
        href={`edu-material://${source.id}/${source.page}`}
        title={material.name}
        onClick={(event) => {
          event.preventDefault()
          onOpenMaterial(source.id)
        }}
      >
        {label}
      </a>
    )
  }
  if (href?.startsWith("edu-topic://")) {
    const id = href.slice("edu-topic://".length)
    const scratchpad = scratchpads.find((item) => item.id === id)
    let label = children
    if (scratchpad) label = `@${scratchpad.title}`
    return (
      <button
        type="button"
        className="inline-flex max-w-full align-baseline rounded-md border border-learning-ink/10 bg-learning-sage/60 px-1.5 py-0.5 text-left text-xs font-medium leading-4 text-learning-ink no-underline hover:bg-learning-sage disabled:cursor-default"
        disabled={!scratchpad || !onOpenScratchpad}
        title={scratchpad ? `Open ${scratchpad.title}` : "This topic no longer exists"}
        onClick={() => onOpenScratchpad?.(id)}
      >
        <span className="min-w-0 max-w-[15rem] truncate">{label}</span>
      </button>
    )
  }
  if (!href?.startsWith("https://"))
    return <span title={href}>{children}</span>
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

export function StudyMarkdown({
  text,
  scratchpads = [],
  onOpenScratchpad,
  materials = [],
  labelMaterials = materials,
  onOpenMaterial,
  showSourcePreviews = false,
  checkLabel = "Check your understanding",
  terminology = [],
}: {
  text: string
  terminology?: TopicTerm[]
  checkLabel?: string
  showSourcePreviews?: boolean
  scratchpads?: { id: string; title: string }[]
  onOpenScratchpad?: (id: string) => void
  materials?: Snapshot["scratchpads"][number]["materials"]
  labelMaterials?: Snapshot["scratchpads"][number]["materials"]
  onOpenMaterial?: (id: string) => void
}) {
  return (
    <div className="markdown">
      <MarkdownReferences.Provider value={{ scratchpads, materials, labelMaterials, onOpenScratchpad, onOpenMaterial }}>
        <UnderstandingCheckLabel.Provider value={checkLabel}>
          <Terminology.Provider value={terminology}>
            <Tooltip.Provider delay={250}>
              <MarkdownContent text={text} materials={materials} showSourcePreviews={showSourcePreviews} terminology={terminology} />
            </Tooltip.Provider>
          </Terminology.Provider>
        </UnderstandingCheckLabel.Provider>
      </MarkdownReferences.Provider>
    </div>
  )
}

const MarkdownContent = memo(function MarkdownContent({ text, materials, showSourcePreviews, terminology }: Required<Pick<
  ComponentProps<typeof StudyMarkdown>, "text" | "materials" | "showSourcePreviews" | "terminology"
>>) {
  const prepared = prepareVisualizationMarkdown(text)
  return (
    <VisualizationBlocks.Provider value={prepared.blocks}>
      <Markdown
        skipHtml
        urlTransform={(url) =>
          /^(edu-source:\/\/[a-f0-9-]+\/\d+|edu-material:\/\/[a-f0-9-]+\/\d+|edu-topic:\/\/[a-f0-9-]+)$/.test(url)
            ? url
            : defaultUrlTransform(url)
        }
        remarkPlugins={[remarkGfm, remarkMath, sectionAnchors, understandingChecks, visualizationMarkdown(prepared), [sourcePreviews, { enabled: showSourcePreviews, materials }], [topicTerminology, { terms: terminology }]]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { plainText: ["mermaid"] }]]}
        components={{
          div: VisualizationMarkdownDiv,
          img: MarkdownImage,
          code: MarkdownCode,
          pre: MarkdownPre,
          a: MarkdownLink,
          mark: MarkdownTerm,
        }}
      >
        {normalizeMathDelimiters(linkSourceCitations(prepared.text, materials))}
      </Markdown>
    </VisualizationBlocks.Provider>
  )
}, (previous, next) => {
  if (previous.text !== next.text || previous.showSourcePreviews !== next.showSourcePreviews) return false
  if (previous.terminology.length !== next.terminology.length || previous.terminology.some((term, index) => {
    const current = next.terminology[index]
    return term.id !== current.id || term.term !== current.term
  })) return false
  // IPC snapshots recreate arrays; citation parsing only depends on these material fields.
  // Links read current labels and handlers from context without reparsing the document.
  return previous.materials.length === next.materials.length && previous.materials.every((material, index) => {
    const current = next.materials[index]
    return material.id === current.id && material.name === current.name && material.kind === current.kind
  })
})
