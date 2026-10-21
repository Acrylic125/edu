import type { ReactNode } from "react"
import {
  ArrowRightIcon,
  ClipboardCheckIcon,
  GraduationCapIcon,
  MessageCircleIcon,
} from "lucide-react"

import { LearningBooks } from "./learning-books"
import { Button } from "../primitives/button"
import { ScrollArea } from "../primitives/scroll-area"
import { cn } from "../utils"

const learningSuggestions = [
  {
    type: "topic",
    label: "Learn calculus",
    description: "Limits, derivatives and integrals",
    prompt:
      "/new-topic Help me learn calculus, starting with limits, derivatives and integrals.",
    icon: GraduationCapIcon,
    color: "bg-learning-yellow",
  },
  {
    type: "test",
    label: "Test Me on ...",
    description: "Put your understanding to the test",
    prompt:
      "/new-test Test me on ...",
    icon: ClipboardCheckIcon,
    color: "bg-learning-sage",
  },
  {
    type: "generic",
    label: "What is a State Machine?",
    description: "Explore a question with free notes",
    prompt: "/new-generic What is a state machine?",
    icon: MessageCircleIcon,
    color: "bg-learning-blue",
  },
]

export function LearningSuggestions({
  disabled = false,
  onSelect,
  testTopic,
}: {
  disabled?: boolean
  testTopic?: { title: string; mention: string }
  onSelect: (prompt: string) => void
}) {
  const suggestions = learningSuggestions.map((suggestion) => {
    if (suggestion.type !== "test" || !testTopic) return suggestion
    return { ...suggestion, label: `Test Me on @${testTopic.title}`, prompt: `/new-test Test me on ${testTopic.mention}` }
  })
  return (
    <div
      className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3"
      aria-label="Learning suggestions"
    >
      {suggestions.map((suggestion) => (
        <Button
          key={suggestion.type}
          aria-label={suggestion.label}
          title={suggestion.label}
          variant="plain"
          size="auto"
          disabled={disabled}
          className={cn(
            "group relative flex min-h-24 min-w-0 flex-row items-center gap-4 overflow-hidden rounded-[1.75rem] px-5 py-5 text-left text-learning-ink transition-shadow hover:ring-2 hover:ring-primary/30 disabled:cursor-not-allowed motion-reduce:transition-none sm:min-h-44 sm:flex-col sm:items-start sm:gap-5",
            suggestion.color,
          )}
          onClick={() => onSelect(suggestion.prompt)}
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-learning-circle">
            <suggestion.icon className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 sm:w-full sm:flex-none">
            <span className="line-clamp-2 text-base font-semibold leading-6 [overflow-wrap:anywhere]">
              {suggestion.label}
            </span>
            <span className="mt-1 block text-xs leading-5 text-learning-subtle">
              {suggestion.description}
            </span>
          </span>
          <ArrowRightIcon
            className="ml-auto size-4 shrink-0 text-learning-subtle sm:absolute sm:right-5 sm:top-8"
            aria-hidden="true"
          />
        </Button>
      ))}
    </div>
  )
}

export function NewTopicView({
  children,
  status,
  introduction,
  footer,
}: {
  children: ReactNode
  status?: ReactNode
  introduction?: ReactNode
  footer?: ReactNode
}) {
  return (
    <ScrollArea className="h-full">
      {status ? (
        <div className="absolute right-6 top-5 max-w-[calc(100%-3rem)] text-right">
          {status}
        </div>
      ) : null}
      <div className="mx-auto flex min-h-full w-full max-w-[850px] flex-1 flex-col justify-center px-5 py-12 sm:px-8 lg:px-10">
        <div className="mb-8 flex items-center justify-between gap-4 sm:mb-10">
          <div className="max-w-lg">
            <h1 className="text-3xl font-semibold leading-[1.12] tracking-[-0.045em] sm:text-4xl lg:text-[2.75rem]">
              What will you
              <br className="hidden sm:block" /> learn today?
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
              Drop in slides, tutorials and past year papers, or start with a
              question.
            </p>
          </div>
          <LearningBooks className="hidden w-[38%] max-w-60 shrink-0 sm:block" />
        </div>
        {introduction ? (
          <p className="mb-6 text-sm text-muted-foreground">{introduction}</p>
        ) : null}
        {children}
        {footer ? (
          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
            {footer}
          </p>
        ) : null}
      </div>
    </ScrollArea>
  )
}

export function LearningDocumentLayout({
  title,
  materials,
  plan,
  children,
  actions,
}: {
  title: string
  materials?: ReactNode
  plan?: ReactNode
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <ScrollArea
      className="workspace-document-enter h-full"
      viewportProps={{ render: <div data-document-scroll /> }}
    >
      <article className="mx-auto w-full max-w-[850px] px-6 pb-24 pt-12 sm:px-12 lg:pt-16">
        <div className="mx-auto max-w-[700px]">
          <h1
            data-document-title
            className="min-w-0 break-words text-3xl font-semibold leading-tight tracking-tight sm:text-[2.5rem]"
          >
            {title}
          </h1>
          {materials ? (
            <div className="mt-5 flex flex-wrap gap-2">{materials}</div>
          ) : null}
          {plan}
          <div className="study-document mt-9">{children}</div>
          {actions}
        </div>
      </article>
    </ScrollArea>
  )
}
