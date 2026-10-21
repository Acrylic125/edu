---
name: writing-style
description: Make what you write, understandable to humans
---

# Writing Style

Write so a tired student understands on the first read. Apply all layers.

Three rules sit above the layers:

- **Cut every word that does no work.** If the sentence survives without a word, the word goes. "In order to" is "to". "It is important to note that" is nothing.
- **Use the short, everyday word.** "Use", not "utilize". "Help", not "facilitate". "Do", not "perform". A long word has to buy its length with precision.
- **When a rule makes a sentence worse, fix the sentence another way or leave it alone.** A sentence that follows every rule and sounds like a machine wrote it has failed.

Don't invent jargon. Use the words a developer would say out loud: "move", "delete", "a budget that only decreases", not "evacuate", "ratchet", or "endgame". A named pattern is fine when the doc says what it means the first time.

## Vary the rhythm

A doc can obey every layer and still read machine-written: every sentence clipped short, no view anywhere, nothing specific.

- Mix sentence lengths on purpose. Short sentences land a point. Longer ones carry a fact with its condition or consequence.
- One thought per sentence does not mean one length per sentence. Split the sentence that carries two thoughts. Keep the long sentence that carries one.
- Have a view where the mode allows it. Explanation weighs trade-offs, so say what you make of them instead of listing pros and cons. Reference stays dry.
- Be specific over sterile. Not "schema changes can cause issues" but "a column rename fails the build".

## Write sentences to the reader (Google developer style)

- Explain the subject directly in the present tense. Use “you” for actions, not accounts of who said or understood what. Keep learning assessments in progress records.
- Say who does what: "the compiler checks", not "is checked". Passive is fine only when the actor is unknown or beside the point.
- Write instructions as commands: "Click Submit." State facts plainly. Never "should be done".
- Put the condition before the instruction: "To delete the document, click Delete."
- Put the common case first. Exceptions after.
- Sound like a knowledgeable friend. No buzzwords, no figurative language, no "please" in instructions, and never "simply", "easy", or "quickly" in a procedure. If it were simple, the reader would not be here.
- Don't pre-announce ("we will soon support...") and don't start consecutive sentences with the same phrase.
- Link with words that say where the link goes: the page title or a short description. Never "click here". Prefer a sentence of context on the page over a link off it.
- Headings name the concept or example's goal, such as “Encoding an addition”. Start with the explanation or concrete example; keep document organization and teaching-process labels implicit. Use sentence case, one h1 per page, and no skipped levels.
- Numbered lists for sequences, bullets for everything else. Introduce a list with a complete sentence. Keep items parallel.
- State the concept directly. Let a compact `Source:` citation carry attribution instead of phrases such as “the lecture also calls for”. In chat, cite attached pages used to teach a concept with a linked `Source:` line. Scratchpad citations can be selective. Original illustrations need no separate citation; their source-based teaching still does.
- Code goes in code font. UI elements go in bold. Use serial commas. Drop "etc." and say up front that a list is partial.

## Make statements load one at a time (STE rules)

- One instruction per sentence. One thought per sentence everywhere else.
- Split instructions longer than about 20 words and other sentences longer than about 25.
- Put the warning or condition before the step it guards: "If hot oil touches your skin, injuries can occur."
- Keep "the" and "a": "Remove backup file" reads two ways. "Remove the backup file" reads one.
- Give each word one meaning and one job, then keep it. If "check" means inspect, don't also use it for restrain.
- Pick one word per action and stick to it: "start", not "start" here and "initiate" there.
- Write procedures as direct commands, never as narration and never in the passive: "Install the component", not "the component must be installed".
- Avoid "-ing" words where you can.

## Leave no sentence open to two readings (Global English)

- Keep words like "only" and "not" next to the word they change: "only fails on growth" and "fails only on growth" say different things.
- Break up long noun strings: "the proto import budget check script" becomes "the script that checks the proto-import budget".
- Make every "it", "they", and "this" point at one obvious thing. Repeat the noun when in doubt. Never use "this" or "which" to point at a whole clause.
- Don't drop verbs: "Phase 1 moves the converters and Phase 2 the runtime" leaves Phase 2 without one. Give it one.
- Keep the small words that show structure, such as "that" in "Ensure that the switch is off". Never trade clarity for word count.
- Repeat the article in a series when it prevents a misread: "the client and the host", not "the client and host", when they are two things.
- Say which parts "and" or "or" joins when a sentence can group two ways. "Both...and", "either...or", and "if...then" are free disambiguators.
- Use periods, not semicolons. Replace an em dash with a new sentence.
- Make text in parentheses a full grammatical unit or its own sentence. Never form plurals with "(s)".
- No slashes: write "a, b, or both" instead of "a/b" or "and/or".
- Call each thing by one name, everywhere. A doc that says "the gate", "the ratchet", and "the budget check" for one thing teaches three things. Don't churn what didn't change.
- Skip idioms, colloquialisms, Latin abbreviations, and metaphors.

## Supplement with Visuals / Blocks per point

Show structure, flow, layout and quantitative relationships visually in chat and scratchpads. Label the example's actual inputs, intermediate steps and taught results; leave pending check results unfilled. Explain what to observe.

- **Code** Use fenced code blocks with the associated language; put identifiers such as `$9` and `$t0` in inline backticks in prose.
- **Quote** Use quotes to quote points `>`.
- **Tables and data:** Use to display the relevant rows/columns with their headers and units.
- **Image / Screenshots** Use source images when quoting or examining the source itself. Create your own diagrams and plots to illustrate concepts in chat and scratchpads.
- **Mermaid Diagrams** Use mermaid diagrams to show flow, class diagrams, pie charts, tree view, sequence, use case diagrams, and/or xy chart.
- **Plots** Use to visualize functions, plots, and 2d/3d charts, heatmap, and animations. Use 
```xml
<visualization settings='{
  "type": "Plotly.js",
  "data": [{
    "type": "scatter",
    "mode": "lines",
    "x": [-2, -1, 0, 1, 2],
    "y": [4, 1, 0, 1, 4]
  }],
  "layout": {
    "title": { "text": "y = x²" }
  }
}' />
``` 
Refer to https://plotly.com/javascript/ 

### Rules
- When quoting or examining a source figure, use its cached render or crop the relevant region and cite it. For explanation, choose or create the clearest illustration; distinguish invented inputs from source data.
- Choose visuals that explain the concept; omit decorative graphics.
- When referring to source code, include the complete relevant loop, conditional, or function in a fenced code block. Include the variables, sizes, initial values, and calls needed to understand that construct. Omit unrelated includes, printing, or program scaffolding only when they are not part of the explanation. Keep the source's actual values and control flow; label any necessary adaptation.
- When explaining code, if no comments are provided, add in 1-2 line comments describing `WHY` it is there.

## Worked example

Before:

> Configuration of the proto import ratchet budget script parameters is performed via budget.json. Note that it's important to remember that running with --write, which updates the committed budget to reflect the current count, should only be done when lowering it. If exceeded, CI fails.

After:

> `budget.mjs` reads the committed budget from `budget.json` and counts the files that import protos. If the count exceeds the budget, CI fails. Run `budget.mjs --write` only to lower the budget.