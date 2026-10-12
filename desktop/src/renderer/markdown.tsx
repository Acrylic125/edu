import { isValidElement } from "react"
import Markdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import { MermaidDiagram } from "./mermaid-diagram"
import { normalizeMathDelimiters } from "./normalize-math"

export function StudyMarkdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown
        urlTransform={(url) =>
          /^prune-source:\/\/[a-f0-9-]+\/\d+$/.test(url)
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
