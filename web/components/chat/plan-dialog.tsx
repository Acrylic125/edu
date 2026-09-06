"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useSession } from "@/lib/auth-client"
import { postSelectTopicStep } from "@/lib/chat/http"
import { useOptionalChatStoreApi } from "@/lib/chat/store"
import type { ChatMessage, ChatSession } from "@/lib/chat/types"
import { cn } from "@/lib/utils"

function topicStructuredPlanFromMessages(messages: ChatMessage[]) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex]
    if (!message) continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = message.parts[partIndex]
      if (part?.type === "plan") return part.steps
    }
  }
  return null
}

function currentPlanStepId(
  messages: ChatMessage[],
  steps: NonNullable<ReturnType<typeof topicStructuredPlanFromMessages>>,
) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex]
    if (!message) continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = message.parts[partIndex]
      if (part?.type !== "options") continue
      for (const option of part.options) {
        const focus = option.label
          .replace(/^(?:explain|practice|what(?:'s| is)|test me on)\s+/i, "")
          .replace(/\?$/, "")
          .trim()
          .toLowerCase()
        const step = steps.find((item) => {
          const label = item.label.trim().toLowerCase()
          return label === focus || label.startsWith(`${focus} `)
        })
        if (step) return step.id
      }
    }
  }
  return steps.find((step) => step.parent === null)?.id ?? steps[0]?.id ?? null
}

function planStepDepths(steps: NonNullable<ReturnType<typeof topicStructuredPlanFromMessages>>) {
  const byId = new Map(steps.map((step) => [step.id, step]))
  const depths = new Map<string, number>()
  function depth(id: string, seen = new Set<string>()): number {
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    const step = byId.get(id)
    if (!step || step.parent === null || seen.has(id)) return 0
    seen.add(id)
    const value = depth(step.parent, seen) + 1
    depths.set(id, value)
    return value
  }
  for (const step of steps) depth(step.id)
  return depths
}

export function PlanDialog({ session }: { session: ChatSession | null }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSelectingStep, setIsSelectingStep] = useState(false)
  const authSession = useSession()
  const store = useOptionalChatStoreApi()
  const hasTopic = session !== null && session.kind === "topic"
  const steps = hasTopic ? topicStructuredPlanFromMessages(session.messages) : null
  const depths = steps ? planStepDepths(steps) : null
  let currentStepId: string | null = null
  if (steps && hasTopic) {
    const storedStepExists = steps.some((step) => step.id === session.currentStepId)
    currentStepId = currentPlanStepId(session.messages, steps)
    if (storedStepExists && session.currentStepId) {
      currentStepId = session.currentStepId
    }
  }

  async function selectStep(stepId: string) {
    if (
      !authSession.data ||
      !store ||
      !hasTopic ||
      isSelectingStep ||
      stepId === currentStepId
    ) {
      return
    }

    setIsSelectingStep(true)
    try {
      await postSelectTopicStep(authSession.data.session.token, session.topicId, stepId)
      store.getState().setCurrentStep(stepId)
    } finally {
      setIsSelectingStep(false)
    }
  }
  const currentStepIndex = steps?.findIndex((step) => step.id === currentStepId) ?? -1
  let progress = 0
  if (steps && currentStepIndex >= 0) {
    progress = ((currentStepIndex + 1) / steps.length) * 100
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="px-2"
            disabled={!hasTopic}
          />
        }
      >
        See Plan
      </DialogTrigger>
      <DialogContent
        keepMounted
        className={cn(
          "max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl",
          isOpen
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-[0.97] opacity-0",
        )}
      >
        <DialogHeader className="border-b border-border/70 bg-card/60 px-6 pt-6 pb-5 pr-14">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="truncate text-xl leading-tight font-semibold">
                {hasTopic ? session.title : "Topic plan"}
              </DialogTitle>
              <DialogDescription className="mt-1.5">
                {steps && currentStepIndex >= 0
                  ? `Step ${currentStepIndex + 1} of ${steps.length}`
                  : "Your learning plan for this topic."}
              </DialogDescription>
            </div>
            {steps && currentStepIndex >= 0 ? (
              <span className="shrink-0 rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary">
                {Math.round(progress)}% complete
              </span>
            ) : null}
          </div>
          {steps ? (
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}
        </DialogHeader>
        {steps ? (
          <div className="max-h-[min(68dvh,34rem)] overflow-y-auto px-4 py-4 sm:px-6">
            <ol className="space-y-1">
              {steps.map((step, index) => {
                const isCurrent = step.id === currentStepId
                const depth = Math.min(depths?.get(step.id) ?? 0, 3)
                return (
                  <li
                    key={step.id}
                    style={{ marginLeft: `${depth * 1.25}rem` }}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isSelectingStep}
                      aria-pressed={isCurrent}
                      className={cn(
                        "h-auto min-h-20 w-full justify-start gap-3 whitespace-normal rounded-xl px-3 py-3 text-left",
                        isCurrent &&
                          "bg-primary/8 text-primary ring-1 ring-primary/25 hover:bg-primary/12",
                      )}
                      onClick={() => {
                        void selectStep(step.id)
                      }}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                          isCurrent
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground",
                        )}
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium">{step.label}</p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {step.summary}
                        </p>
                      </div>
                    </Button>
                  </li>
                )
              })}
            </ol>
          </div>
        ) : (
          <p className="px-6 py-8 text-sm text-muted-foreground">
            This topic does not have a saved learning plan yet.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
