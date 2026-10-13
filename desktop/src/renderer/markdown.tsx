import { isValidElement } from "react"
import Markdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import { MermaidDiagram } from "./mermaid-diagram"
import { normalizeMathDelimiters } from "./normalize-math"

export function StudyMarkdown({
  text,
  topics = [],
  onOpenTopic,
}: {
  text: string
  topics?: { id: string; title: string }[]
  onOpenTopic?: (id: string) => void
}) {
  return (
    <div className="markdown">
      <Markdown
        urlTransform={(url) =>
          /^(prune-source:\/\/[a-f0-9-]+\/\d+|edu-topic:\/\/[a-f0-9-]+)$/.test(url)
            ? url
            : defaultUrlTransform(url)
        }
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
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
        {normalizeMathDelimiters(text)}
      </Markdown>
    </div>
  )
}
