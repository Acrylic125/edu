import type { ComponentProps } from "react"
import { MessageSquareText } from "lucide-react"
import type { z } from "zod"
import type { TestStateSchema } from "../shared/scratchpad-state"
import { resolveMaterialLink } from "../shared/material-links"
import { StudyMarkdown } from "./markdown"

function testAnswerMarkdown(answer: string, materials: NonNullable<ComponentProps<typeof StudyMarkdown>["materials"]>) {
  const filenames = materials.filter((material) => material.kind === "image")
    .map((material) => material.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  if (!filenames.length) return answer
  // Older answers stored image paths as prose rather than Markdown embeds.
  const references = new RegExp("```[\\s\\S]*?```|~~~[\\s\\S]*?~~~|!?\\[[^\\]\\n]*\\]\\([^\\n]*?\\)|`[^`\\n]*`|assets/(?:" + filenames.join("|") + ")(?![\\w.-])", "g")
  return answer.replace(references, (match) => {
    const path = match.replace(/^`(.*)`$/, "$1")
    const source = resolveMaterialLink(path, materials)
    if (!source) return match
    return `[attached image](edu-material://${source.id}/${source.page})`
  })
}

export function TestScratchpad({ state, ...markdownProps }: {
  state: z.infer<typeof TestStateSchema>
} & Omit<ComponentProps<typeof StudyMarkdown>, "text">) {
  return (
    <div className="space-y-10">
      <div className="divide-y divide-border">
        {state.questions.map((question, index) => (
          <section key={question.title} aria-labelledby={`test-question-${index}`} className="space-y-4 py-7 first:pt-0 last:pb-0">
            <div className="space-y-2.5">
              <h2 id={`test-question-${index}`} className="text-sm font-semibold">Question {index + 1}</h2>
              <StudyMarkdown {...markdownProps} text={question.question} />
            </div>
            <div className="rounded-xl bg-learning-sage p-3.5 text-learning-ink">
              <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                <MessageSquareText aria-hidden="true" className="size-3.5 shrink-0" />
                Your answer
              </h3>
              {question.answer?.trim() ? (
                <StudyMarkdown {...markdownProps} showSourcePreviews text={testAnswerMarkdown(question.answer, markdownProps.materials ?? [])} />
              ) : (
                <p className="text-sm opacity-70">Not answered yet</p>
              )}
            </div>
          </section>
        ))}
      </div>
      {state.questions.length === 0 && <p className="text-sm text-muted-foreground">Questions will appear here when your test is ready.</p>}

    </div>
  )
}
