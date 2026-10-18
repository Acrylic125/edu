import { createContext, useContext, isValidElement, type ComponentPropsWithoutRef } from "react"
import Markdown, { defaultUrlTransform, type ExtraProps } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "rehype-highlight"
import "katex/dist/katex.min.css"
import { prepareVisualizationMarkdown, visualizationMarkdown } from "./visualization/markdown"
import { PlotlyVisualization } from "./visualization/plotly-visualization"
import { MermaidDiagram } from "./mermaid-diagram"
import { MediaPreview } from "./media-preview"
import { normalizeMathDelimiters } from "./normalize-math"
import { linkSourceCitations } from "./source-citations"
import { resolveMaterialLink } from "../shared/material-links"
import { sectionAnchors } from "./section-anchors"
import type { Snapshot } from "../shared/contracts"

const VisualizationBlocks = createContext<ReturnType<typeof prepareVisualizationMarkdown>["blocks"]>([])

function VisualizationMarkdownDiv({ node, children }: ComponentPropsWithoutRef<"div"> & ExtraProps) {
  const blocks = useContext(VisualizationBlocks)
  const index = node?.properties["data-visualization-index"]
  if (typeof index === "number" && blocks[index]) {
    const block = blocks[index]
    return <PlotlyVisualization source={block.source} pending={block.pending} />
  }
  return <div>{children}</div>
}

export function StudyMarkdown({
  text,
  topics = [],
  onOpenTopic,
  materials = [],
  onOpenMaterial,
}: {
  text: string
  topics?: { id: string; title: string }[]
  onOpenTopic?: (id: string) => void
  materials?: Snapshot["topics"][number]["materials"]
  onOpenMaterial?: (id: string) => void
}) {
  const prepared = prepareVisualizationMarkdown(text)
  return (
    <div className="markdown">
      <VisualizationBlocks.Provider value={prepared.blocks}>
      <Markdown
        skipHtml
        urlTransform={(url) =>
          /^(prune-source:\/\/[a-f0-9-]+\/\d+|edu-material:\/\/[a-f0-9-]+\/\d+|edu-topic:\/\/[a-f0-9-]+)$/.test(url)
            ? url
            : defaultUrlTransform(url)
        }
        remarkPlugins={[remarkGfm, remarkMath, sectionAnchors, visualizationMarkdown(prepared)]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { plainText: ["mermaid"] }]]}
        components={{
          div: VisualizationMarkdownDiv,
          img: ({ src, alt, title }) => (
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
          ),
          code: ({ className, children }) => {
            if (className?.split(" ").includes("language-mermaid")) {
              return <MermaidDiagram definition={String(children).trimEnd()} />
            }
            return <code className={className}>{children}</code>
          },
          pre: ({ children }) => {
            if (
              isValidElement<{ className?: string }>(children) &&
              children.props.className?.split(" ").includes("language-mermaid")
            ) {
              return <div>{children}</div>
            }
            return <pre>{children}</pre>
          },
          a: ({ href, children }) => {
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
              return (
                <a
                  href={`edu-material://${source.id}/${source.page}`}
                  onClick={(event) => {
                    event.preventDefault()
                    onOpenMaterial(source.id)
                  }}
                >
                  {children}
                </a>
              )
            }
            if (href?.startsWith("edu-topic://")) {
              const id = href.slice("edu-topic://".length)
              const topic = topics.find((item) => item.id === id)
              let label = children
              if (topic) label = `@${topic.title}`
              return (
                <button
                  type="button"
                  className="inline-flex max-w-full align-baseline rounded-md border border-learning-ink/10 bg-learning-sage/60 px-1.5 py-0.5 text-left text-xs font-medium leading-4 text-learning-ink no-underline hover:bg-learning-sage disabled:cursor-default"
                  disabled={!topic || !onOpenTopic}
                  title={topic ? `Open ${topic.title}` : "This topic no longer exists"}
                  onClick={() => onOpenTopic?.(id)}
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
          },
        }}
      >
        {normalizeMathDelimiters(linkSourceCitations(prepared.text, materials))}
      </Markdown>
      </VisualizationBlocks.Provider>
    </div>
  )
}
