import { describe, expect, it } from "vitest"

import { formatPlanOutline, parsePlanOutline } from "./plan-outline"

const plan = [
  { id: "arrays", label: "Arrays & Lists", summary: "Sequential structures", parent: null },
  { id: "storage", label: "Array Storage", summary: "Array representation", parent: "arrays" },
  { id: "linked", label: "Linked Lists", summary: "Linked nodes", parent: "arrays" },
  { id: "trees", label: "Trees & Graphs", summary: "Hierarchical structures", parent: null },
]

describe("editable plan outlines", () => {
  it("formats and parses a nested plan without losing ids or summaries", () => {
    const outline = formatPlanOutline(plan)
    expect(outline).toBe("Arrays & Lists\n  Array Storage\n  Linked Lists\nTrees & Graphs")
    expect(parsePlanOutline(outline, plan)).toEqual(plan)
  })

  it("accepts pasted bullet lists and creates the intended hierarchy", () => {
    expect(parsePlanOutline("Arrays & Lists\n- Array Storage\n- Linked Lists\nTrees & Graphs", [])).toMatchObject([
      { label: "Arrays & Lists", parent: null },
      { label: "Array Storage" },
      { label: "Linked Lists" },
      { label: "Trees & Graphs", parent: null },
    ])
    const parsed = parsePlanOutline("Arrays & Lists\n- Array Storage\n- Linked Lists\nTrees & Graphs", [])
    expect(parsed[1]?.parent).toBe(parsed[0]?.id)
    expect(parsed[2]?.parent).toBe(parsed[0]?.id)
  })
})
