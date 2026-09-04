# Agent decision tree

This document describes the current `edu-api` chat-agent routing behavior. Keep it updated whenever routing, confirmation, generation, or validation behavior changes.

```mermaid
flowchart TD
    A["Incoming message"] --> B["Extract text and attached images"]
    B --> C["Load active topic and recent history"]
    C --> D{"Explicit slash command?"}

    D -- "/new" --> NEW["Create topic immediately"]
    D -- "/update" --> UPDATE["Update learning plan immediately"]
    D -- "/new-qns" --> QUESTION["Generate practice question"]
    D -- "/ans" --> GRADE["Identify and grade answer"]
    D -- "/topic" --> CHAT["Explain or discuss"]
    D -- "No" --> E{"Active topic?"}

    E -- "No" --> F{"Request is ‘what's next?’"}
    F -- "Yes" --> CHAT
    F -- "No" --> G["Generate proposed topic"]
    G --> H{"Valid topic generated?"}
    H -- "No" --> CHAT
    H -- "Yes" --> PROPOSE_CREATE["Ask user to confirm topic creation"]

    E -- "Yes" --> I{"Obvious intent?"}
    I -- "Quiz me or another question" --> QUESTION
    I -- "Student work after practice question" --> GRADE
    I -- "Diagram or visualization request" --> CHAT
    I -- "No" --> J{"Natural-language next-section request?"}

    J -- "Yes" --> PROPOSE_UPDATE["Propose learning-plan update"]
    J -- "No" --> K["LLM intent classification"]
    K --> L{"Classified intent"}
    L -- "Chat" --> CHAT
    L -- "New question" --> QUESTION
    L -- "Update topic" --> PROPOSE_UPDATE
    L -- "New topic while active" --> PROPOSE_UPDATE
    L -- "Answer" --> M{"Recent practice question?"}

    M -- "Yes" --> GRADE
    M -- "No" --> N["Try to identify a question"]
    N --> O{"Question found?"}
    O -- "Yes" --> GRADE
    O -- "No" --> CHAT

    PROPOSE_CREATE --> P{"User decision"}
    PROPOSE_UPDATE --> P
    P -- "Accept" --> APPLY["Apply proposed change"]
    P -- "Reject" --> CANCEL["Cancel without mutation"]

    NEW --> PLAN["Generate 3–8 chapter plan"]
    APPLY --> Q{"Proposal type"}
    Q -- "Create topic" --> PLAN
    Q -- "Update topic" --> UPDATED["Save title, summary, or focus"]

    GRADE --> DOMAIN{"Topic is STEM?"}
    DOMAIN -- "No" --> UNSUPPORTED["Return STEM-only notice"]
    DOMAIN -- "Yes" --> VERIFY["Verify solution"]
    VERIFY --> FEEDBACK["Explain correctness, errors, and next step"]

    QUESTION --> OPTIONS["Return question and follow-up options"]
    CHAT --> RESPONSE["Generate explanation"]
    PLAN --> PLAN_OPTIONS["Return plan and learning options"]
    UPDATED --> UPDATE_OPTIONS["Return confirmation and learning options"]

    CANCEL --> VALIDATE
    UNSUPPORTED --> VALIDATE
    FEEDBACK --> VALIDATE
    OPTIONS --> VALIDATE
    RESPONSE --> VALIDATE
    PLAN_OPTIONS --> VALIDATE
    UPDATE_OPTIONS --> VALIDATE
    PROPOSE_CREATE --> VALIDATE
    PROPOSE_UPDATE --> VALIDATE

    VALIDATE{"All LaTeX valid?"}
    VALIDATE -- "Yes" --> FINAL["Send complete response in run.ended"]
    VALIDATE -- "No" --> REPAIR["LLM repairs invalid LaTeX"]
    REPAIR --> RECHECK["Validate repaired LaTeX"]
    RECHECK --> FINAL
```

## Response delivery

- Progress events may still be sent while the agent works.
- Provisional response text is streamed through `run.delta` events.
- While streaming, the client renders Markdown prose but does not execute KaTeX or Mermaid.
- The completed response is validated and repaired before `run.ended`.
- `run.ended` replaces the provisional text with the authoritative response, after which the client renders validated math and diagrams.

## Latency controls

- Obvious diagram and visualization requests bypass LLM intent classification.
- LLM intent classification is capped at 16 output tokens.
- Topic summaries run outside the response-delivery path and only when the topic message count reaches a multiple of 20.
- Previous Mermaid source is replaced with a short placeholder in model history.
- Diagram responses place Mermaid where it best supports the explanation, always complete and close the block, avoid redundant edge-by-edge prose, and use a 640-token output cap.

## Final-response validation

Before persistence and final delivery, every text part is checked for inline `$...$`, display `$$...$$`, fenced `latex` or `tex` blocks, and fenced `mermaid` blocks. Unclosed delimiters and fences are rejected. KaTeX validates each math expression, while Worker-safe structural checks verify that Mermaid blocks are complete and use a supported diagram directive. The browser's Mermaid renderer performs full parsing. If server validation fails, the agent makes one repair call and uses the corrected response only if it passes validation. If repair also fails, rich markup is converted to inert text instead of being executed by the client.

## Diagram output

When a student asks for a diagram, visualization, state machine, flowchart, graph, or process map, the response-generation prompt instructs the agent to return valid Mermaid inside a fenced `mermaid` block. It must not substitute ASCII art for the diagram.
