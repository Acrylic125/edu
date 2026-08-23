"use client"

import { normalizeAssistantMath } from "@/lib/chat/normalize-math"
import Markdown from "react-markdown"
import type { Components } from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkMath from "remark-math"

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
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md bg-muted p-3 text-sm last:mb-0">
      {children}
    </pre>
  ),
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
        remarkPlugins={[remarkMath]}
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
    <Markdown components={assistantMarkdownComponents}>{text}</Markdown>
  )
}
