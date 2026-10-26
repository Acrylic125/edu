import assert from "node:assert/strict"
import { test } from "node:test"
import type { Nodes } from "mdast"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { topicTerminology, type TopicTerm } from "./topic-terminology"

function highlightedTerms(text: string, terms: TopicTerm[]) {
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(topicTerminology, { terms })
  const tree = parser.runSync(parser.parse(text))
  const matches: string[] = []
  function visit(node: Nodes) {
    if (node.data?.hName === "mark" && "children" in node) {
      matches.push(node.children.map((child) => "value" in child ? child.value : "").join(""))
    }
    if ("children" in node) node.children.forEach(visit)
  }
  visit(tree)
  return matches
}

test("terminology matches whole terms, preserves case, and prefers longer phrases", () => {
  const terms: TopicTerm[] = [
    { type: "term", id: "net", term: "net", meaning: "A network" },
    { type: "term", id: "neural-net", term: "neural net", meaning: "A model" },
    { type: "term", id: "cpp", term: "C++", meaning: "A language" },
    { type: "term", id: "cafe", term: "café", meaning: "A coffee shop" },
  ]
  assert.deepEqual(highlightedTerms("NEURAL NET, net; internet and netting. C++ (café), décaféiné.", terms), ["NEURAL NET", "net", "C++", "café"])
  assert.deepEqual(highlightedTerms("No terminology.", []), [])
})

test("terminology highlights prose and formatted text while preserving references, code, math, and the glossary", () => {
  const terms: TopicTerm[] = [{ type: "term", id: "slope", term: "slope", meaning: "Rate of change" }]
  const text = [
    "## Slope",
    "The **slope** and *slope* change.",
    "[slope](https://example.com) and `slope` and $slope$.",
    "```ts\nconst slope = 2\n```",
    "| Property | Value |\n|---|---|\n| slope | 2 |",
    "## Topic terminology",
    "| Term | Meaning |\n|---|---|\n| slope | The slope is a rate. |",
    "## More notes",
    "The slope increases.",
  ].join("\n\n")
  assert.deepEqual(highlightedTerms(text, terms), ["slope", "slope", "slope", "slope"])
})
