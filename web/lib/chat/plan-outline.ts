import type { TopicPlanStep } from "./ws-schema"

function depthsForPlan(steps: TopicPlanStep[]) {
  const byId = new Map(steps.map((step) => [step.id, step]))
  const depths = new Map<string, number>()

  function depth(stepId: string, seen = new Set<string>()): number {
    const cached = depths.get(stepId)
    if (cached !== undefined) return cached
    const step = byId.get(stepId)
    if (!step || step.parent === null || seen.has(stepId)) return 0
    seen.add(stepId)
    const value = depth(step.parent, seen) + 1
    depths.set(stepId, value)
    return value
  }

  for (const step of steps) depth(step.id)
  return depths
}

export function formatPlanOutline(steps: TopicPlanStep[]) {
  const depths = depthsForPlan(steps)
  return steps
    .map((step) => `${"  ".repeat(depths.get(step.id) ?? 0)}${step.label}`)
    .join("\n")
}

export function parsePlanOutline(outline: string, existing: TopicPlanStep[]) {
  const lines = outline
    .split(/\r?\n/)
    .map((source) => {
      const leading = source.match(/^\s*/)?.[0] ?? ""
      const spaces = leading.replace(/\t/g, "  ").length
      const hasBullet = /^\s*[-*+]\s+/.test(source)
      let depth = Math.floor(spaces / 2)
      if (hasBullet) depth = Math.max(1, depth)
      return {
        depth,
        label: source.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim(),
      }
    })
    .filter((line) => line.label.length > 0)

  const usedIds = new Set<string>()
  const steps = lines.map((line, index) => {
    let previous = existing.find(
      (step) => !usedIds.has(step.id) && step.label.toLowerCase() === line.label.toLowerCase(),
    )
    if (!previous) {
      const samePosition = existing[index]
      if (samePosition && !usedIds.has(samePosition.id)) previous = samePosition
    }

    const slug = line.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)
    const id = previous?.id ?? `step-${index + 1}-${slug || "item"}`
    usedIds.add(id)
    let summary = line.label
    if (previous && previous.summary !== previous.label) summary = previous.summary
    return { ...line, id, summary }
  })

  return steps.map((step, index) => {
    let parent: string | null = null
    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = steps[candidateIndex]
      if (candidate && candidate.depth < step.depth) {
        parent = candidate.id
        break
      }
    }
    return {
      id: step.id,
      label: step.label,
      summary: step.summary,
      parent,
    }
  })
}
