import type { ReactNode } from "react"
import {
  ArrowRightIcon,
  BookOpenIcon,
  CalculatorIcon,
  CodeIcon,
} from "lucide-react"

import { LearningBooks } from "./learning-books"
import { Button } from "../primitives/button"
import { cn } from "../utils"

const learningSuggestions = [
  {
    label: "Learn calculus",
    description: "Limits, derivatives and integrals",
    prompt:
      "Help me learn calculus, starting with limits, derivatives and integrals.",
    icon: CalculatorIcon,
    color: "bg-learning-yellow",
  },
  {
    label: "Explore automata",
    description: "From finite states to languages",
    prompt:
      "Help me learn automata and formal languages, starting with finite automata.",
    icon: CodeIcon,
    color: "bg-learning-sage",
  },
  {
    label: "Prepare for an exam",
    description: "Turn your papers into practice",
    prompt: "Help me prepare for my exam using my slides and past year papers.",
    icon: BookOpenIcon,
    color: "bg-learning-blue",
  },
]

export function LearningSuggestions({
  disabled = false,
  onSelect,
}: {
  disabled?: boolean
  onSelect: (prompt: string) => void
}) {
  return (
    <div
      className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3"
      aria-label="Learning suggestions"
    >
      {learningSuggestions.map((suggestion) => (
        <Button
          key={suggestion.label}
          variant="plain"
          size="auto"
          disabled={disabled}
          className={cn(
            "group relative flex min-h-24 flex-row items-center gap-4 overflow-hidden rounded-[1.75rem] px-5 py-5 text-left text-learning-ink transition-shadow hover:ring-2 hover:ring-primary/30 disabled:cursor-not-allowed motion-reduce:transition-none sm:min-h-44 sm:flex-col sm:items-start sm:gap-5",
            suggestion.color,
          )}
          onClick={() => onSelect(suggestion.prompt)}
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-learning-circle">
            <suggestion.icon className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold">
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
    <div className="relative h-full overflow-y-auto">
      {status ? (
        <div className="absolute right-6 top-5 max-w-[calc(100%-3rem)] text-right">
          {status}
        </div>
      ) : null}
      <div className="mx-auto flex min-h-full w-full max-w-[850px] flex-col justify-center px-5 py-12 sm:px-8 lg:px-10">
        <div className="mb-8 flex items-center justify-between gap-4 sm:mb-10">
          <div className="max-w-lg">
            <span className="mb-5 flex size-12 items-center justify-center rounded-full bg-learning-yellow text-primary">
              <BookOpenIcon className="size-5" aria-hidden="true" />
            </span>
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
    </div>
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
    <div data-document-scroll className="h-full overflow-y-auto">
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
    </div>
  )
}

export function LearningPlan({
  items,
  onSelect,
  disabled = false,
  label = "Table of contents",
}: {
  items: { id: string; label: string; selected?: boolean; nested?: boolean }[]
  onSelect?: (id: string) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <nav
      className="mt-9 rounded-[1.5rem] bg-learning-sage/50 px-6 py-6"
      aria-label={label}
    >
      <h2 className="text-base font-semibold">Table of contents</h2>
      <ol className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              "text-sm leading-snug text-muted-foreground",
              !onSelect && item.selected && "font-medium text-foreground",
            )}
            style={{ paddingLeft: item.nested ? "1.2rem" : undefined }}
          >
            {onSelect ? (
              <Button
                variant="plain"
                size="auto"
                aria-current={item.selected ? "step" : undefined}
                disabled={disabled}
                className="w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-learning-circle aria-[current=step]:bg-learning-circle aria-[current=step]:font-medium aria-[current=step]:text-foreground disabled:cursor-not-allowed"
                onClick={() => onSelect(item.id)}
              >
                {item.label}
              </Button>
            ) : (
              item.label
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
