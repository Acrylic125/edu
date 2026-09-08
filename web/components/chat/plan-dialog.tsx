"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useSession } from "@/lib/auth-client"
import { fetchTopic, patchTopic, postSelectTopicStep } from "@/lib/chat/http"
import { formatPlanOutline, parsePlanOutline } from "@/lib/chat/plan-outline"
import { useOptionalChatStoreApi } from "@/lib/chat/store"
import type { ChatSession } from "@/lib/chat/types"
import { UpdateTopicRequestSchema, type TopicPlanStep } from "@/lib/chat/ws-schema"
import { cn } from "@/lib/utils"

function planStepDepths(steps: TopicPlanStep[]) {
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
  const [isEditing, setIsEditing] = useState(false)
  const [isSelectingStep, setIsSelectingStep] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftSummary, setDraftSummary] = useState("")
  const [draftOutline, setDraftOutline] = useState("")
  const [draftRevision, setDraftRevision] = useState("")
  const authSession = useSession()
  const store = useOptionalChatStoreApi()
  const hasTopic = session !== null && session.kind === "topic"
  const steps = hasTopic ? session.plan : []
  const depths = planStepDepths(steps)
  const currentStepId = hasTopic ? session.currentStepId ?? null : null
  const currentStepIndex = steps.findIndex((step) => step.id === currentStepId)
  const draftSteps = hasTopic ? parsePlanOutline(draftOutline, session.plan) : []
  const draftIsDirty =
    hasTopic &&
    (draftTitle !== session.title ||
      draftSummary !== session.summary ||
      JSON.stringify(draftSteps) !== JSON.stringify(session.plan))

  async function refreshPlan() {
    if (!authSession.data || !store || !hasTopic || isRefreshing) return
    setIsRefreshing(true)
    setError(null)
    try {
      const topic = await fetchTopic(authSession.data.session.token, session.topicId)
      store.getState().setTopicDetails(topic)
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Could not refresh the learning plan",
      )
    } finally {
      setIsRefreshing(false)
    }
  }

  function changeOpen(nextOpen: boolean) {
    if (
      !nextOpen &&
      isEditing &&
      draftIsDirty &&
      !window.confirm("Discard your unsaved plan changes?")
    ) {
      return
    }
    setIsOpen(nextOpen)
    if (!nextOpen) {
      setIsEditing(false)
      setError(null)
      return
    }
    void refreshPlan()
  }

  function beginEditing() {
    if (!hasTopic) return
    setDraftTitle(session.title)
    setDraftSummary(session.summary)
    setDraftOutline(formatPlanOutline(session.plan))
    setDraftRevision(session.updatedAt)
    setError(null)
    setIsEditing(true)
  }

  function cancelEditing() {
    if (draftIsDirty && !window.confirm("Discard your unsaved plan changes?")) return
    setIsEditing(false)
    setError(null)
  }

  async function selectStep(stepId: string) {
    if (!authSession.data || !store || !hasTopic || isSelectingStep || stepId === currentStepId) return
    setIsSelectingStep(true)
    setError(null)
    try {
      await postSelectTopicStep(authSession.data.session.token, session.topicId, stepId)
      store.getState().setCurrentStep(stepId)
      setIsOpen(false)
    } catch {
      setError("Could not select that step. Please try again.")
    } finally {
      setIsSelectingStep(false)
    }
  }

  async function savePlan() {
    if (!authSession.data || !store || !hasTopic || isSaving) return
    const parsed = UpdateTopicRequestSchema.safeParse({
      title: draftTitle,
      summary: draftSummary,
      plan: draftSteps,
      expectedUpdatedAt: draftRevision,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the plan and try again.")
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const topic = await patchTopic(authSession.data.session.token, session.topicId, parsed.data)
      store.getState().setTopicDetails(topic)
      setIsEditing(false)
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the learning plan",
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={changeOpen}>
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
          "max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl",
          isOpen
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-[0.97] opacity-0",
        )}
      >
        <DialogHeader className="border-b border-border/70 bg-card/60 px-5 pt-5 pb-4 pr-14 sm:px-6 sm:pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-xl leading-tight font-semibold">
                {isEditing
                  ? "Edit learning plan"
                  : hasTopic
                    ? session.title
                    : "Topic plan"}
              </DialogTitle>
              <DialogDescription className="mt-1.5">
                {isEditing
                  ? "Edit the outline directly. Use two spaces to nest a step."
                  : currentStepIndex >= 0
                    ? `Currently on: ${steps[currentStepIndex]?.label}`
                    : "Your learning plan for this topic."}
              </DialogDescription>
            </div>
            {!isEditing && hasTopic ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRefreshing}
                onClick={beginEditing}
              >
                <Pencil />
                Edit plan
              </Button>
            ) : null}
          </div>
        </DialogHeader>

        {isEditing ? (
          <div className="max-h-[min(72dvh,42rem)] overflow-y-auto">
            <div className="space-y-5 px-4 py-5 sm:px-6">
              <div className="space-y-1.5">
                <Label htmlFor="plan-title">Topic title</Label>
                <Input
                  id="plan-title"
                  value={draftTitle}
                  maxLength={120}
                  onChange={(event) => setDraftTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-summary">Learning goal</Label>
                <Textarea
                  id="plan-summary"
                  value={draftSummary}
                  maxLength={4000}
                  className="min-h-20 resize-y"
                  onChange={(event) => setDraftSummary(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-outline">Plan outline</Label>
                <Textarea
                  id="plan-outline"
                  aria-label="Plan outline"
                  autoFocus
                  value={draftOutline}
                  className="min-h-72 resize-y font-mono text-sm leading-7"
                  placeholder={"Arrays & Lists\n  Array Storage\n  Linked Lists\nTrees & Graphs"}
                  onChange={(event) => setDraftOutline(event.target.value)}
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  One step per line. Use two spaces or a dash to nest a step. You can paste and rewrite the whole outline at once.
                </p>
              </div>
            </div>
            <div className="sticky bottom-0 flex flex-col gap-3 border-t border-border bg-background/95 px-4 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p
                role="status"
                className={cn(
                  "text-sm",
                  error ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {error ?? `${draftSteps.length} plan steps`}
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSaving}
                  onClick={cancelEditing}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={isSaving || !draftIsDirty}
                  onClick={() => void savePlan()}
                >
                  {isSaving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          </div>
        ) : steps.length > 0 ? (
          <div className="max-h-[min(68dvh,34rem)] overflow-y-auto px-4 py-4 sm:px-6">
            {error ? (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <ol className="space-y-1">
              {steps.map((step, index) => {
                const isCurrent = step.id === currentStepId
                const depth = Math.min(depths.get(step.id) ?? 0, 3)
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
                        "h-auto min-h-16 w-full justify-start gap-3 whitespace-normal rounded-xl px-3 py-3 text-left",
                        isCurrent &&
                          "bg-primary/8 text-primary ring-1 ring-primary/25 hover:bg-primary/12",
                      )}
                      onClick={() => void selectStep(step.id)}
                    >
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                          isCurrent
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground",
                        )}
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium">{step.label}</span>
                        <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">
                          {step.summary}
                        </span>
                      </span>
                    </Button>
                  </li>
                )
              })}
            </ol>
          </div>
        ) : (
          <div className="px-6 py-8">
            <p className="text-sm text-muted-foreground">
              {isRefreshing
                ? "Loading your learning plan…"
                : "This topic does not have a saved learning plan yet."}
            </p>
            {error ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
