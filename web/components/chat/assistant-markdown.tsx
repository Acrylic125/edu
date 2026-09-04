"use client"

import { normalizeAssistantMath } from "@/lib/chat/normalize-math"
import Markdown from "react-markdown"
import type { Components } from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { isValidElement } from "react"

import { MermaidDiagram } from "@/components/chat/mermaid-diagram"

import "katex/dist/katex.min.css"

const assistantMarkdownComponents: Components = {
  p: ({ children }) => (
    <div className="mb-2 last:mb-0">{children}</div>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    if (className?.split(" ").includes("language-mermaid")) {
      return <MermaidDiagram definition={String(children).trimEnd()} />
    }
    return (
      <code
        className={`${className ?? ""} rounded bg-muted px-1 py-0.5 text-[0.9em]`}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }) => {
    if (
      isValidElement<{ className?: string }>(children) &&
      children.props.className?.split(" ").includes("language-mermaid")
    ) {
      return <div className="mb-2 last:mb-0">{children}</div>
    }
    return (
      <pre className="mb-2 overflow-x-auto rounded-md bg-muted p-3 text-sm last:mb-0">
        {children}
      </pre>
    )
  },
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  h1: ({ children }) => (
    <h1 className="mb-2 text-xl font-bold last:mb-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 text-lg font-bold last:mb-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 text-base font-semibold last:mb-0">{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-muted-foreground/40 pl-3 italic last:mb-0">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-border/60 last:border-b-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1.5 font-semibold align-top">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1.5 align-top">{children}</td>
  ),
}

export function AssistantMarkdown({
  text,
  enableMath,
}: {
  text: string
  enableMath: boolean
}) {
  if (enableMath) {
    return (
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, output: "html" }],
        ]}
        components={assistantMarkdownComponents}
      >
        {normalizeAssistantMath(text)}
      </Markdown>
    )
  }

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={assistantMarkdownComponents}
    >
      {text}
    </Markdown>
  )
}
