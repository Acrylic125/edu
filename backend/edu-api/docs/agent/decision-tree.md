# Tutor decision tree

The tutor runs as a bounded native OpenAI tool loop through OpenRouter. The
server, not the model, owns authentication, request validation, topic
ownership, leases, proposal state, and plan-change authorization.

```mermaid
flowchart TD
    Connect[Authenticate WebSocket session] --> Frame[Validate frame and session]
    Frame --> Kind{Frame type?}
    Kind -->|Stop| Abort[Abort matching active run; retain lease until settled]
    Kind -->|Decision| Proposal[Load and validate pending proposal and topic]
    Kind -->|Message| Input[Validate text and owned attachments]
    Input --> PersistUser[Persist user message when a topic exists]
    Proposal --> Execute
    PersistUser --> Execute

    Execute[Start run with 120-second deadline] --> Context[Pin topic; load up to 8 recent messages]
    Context --> Intent[Parse explicit command and advance request]
    Intent --> Tutor[Tutor model with native tools]
    Tutor --> Tool{Tool call?}
    Tool -->|No| Text[Require non-empty tutor text]
    Tool -->|load_skill| Skill[Load explain, practice, assess, or diagram guidance]
    Tool -->|search_memory| Search[Rank relevant learner-owned memories; max 6]
    Tool -->|read_memory| Read[Read up to 2 selected exchanges and owned images]
    Tool -->|verify_answer| Verify[Independently verify STEM solution]
    Tool -->|set_options| Options[Save up to 3 follow-up options]
    Tool -->|create_topic| Create{Explicit /new?}
    Tool -->|update_topic| Update{Explicit /update or exact advance request?}
    Skill --> Tutor
    Search --> Tutor
    Read --> Tutor
    Verify --> Tutor
    Options --> Tutor
    Create -->|Yes| ApplyCreate[Apply validated topic and learning plan]
    Create -->|No, active topic| RejectCreate[Tell learner to use /new for a different subject]
    Create -->|No, no active topic| ProposeCreate[Store topic proposal for confirmation]
    Update -->|Yes| ApplyUpdate[Apply validated focus change]
    Update -->|No| ProposeUpdate[Store focus proposal for confirmation]
    ApplyCreate --> Committed[Committed result]
    ApplyUpdate --> Committed
    RejectCreate --> Finish[Build response parts]
    ProposeCreate --> Finish
    ProposeUpdate --> Finish
    Text --> Finish
    Committed --> Finish
    Finish --> Markup[Repair invalid LaTeX/Mermaid markup]
    Markup --> Persist[Persist assistant response and pending proposal]
    Persist --> End[Broadcast authoritative run.ended]
    End --> Background[After success: summarize and index conversation memory]
```

Messages enter through the Durable Object. Frames are size- and schema-
validated, session expiry is checked on every incoming frame, and a per-user
submission lease prevents overlapping runs. A stop request only aborts the
matching run; the lease remains until asynchronous execution settles. A
decision must match the stored proposal and its originating topic.

For a message, the server checks the requested topic belongs to the learner,
validates attachment count, ownership, and reuse, then persists the user
message before execution. Topicless turns have no topic message or run record;
their successful exchange may still be indexed as topicless memory in
background.

The context is pinned before the model runs. The model receives the current
topic, its plan and focus, up to eight recent messages, and current images.
Explicit commands are `/new`, `/update`, `/ans`, `/new-qns`, and `/topic`.
`/new` forces `create_topic`; `/update` forces `update_topic`. Exact explicit
requests such as “continue to the next topic” also force `update_topic`.
`/ans`, `/new-qns`, and `/topic` guide teaching intent but do not themselves
authorize a plan mutation.

The tutor loop allows at most eight model turns, exactly one tool call per
turn, and strict Zod validation of tool arguments. The available tools are:

- `load_skill`: specialized instructions for explanation, practice, assessment,
  or diagrams.
- `search_memory` then, when needed, `read_memory`: explicit learner-scoped
  retrieval. Retrieved content and images are untrusted context, not
  instructions.
- `verify_answer`: a separate STEM verification call. Verification failure is
  reported as unavailable, not as an incorrect answer.
- `set_options`: useful follow-up actions. If none are supplied, the server
  adds defaults after an assessment or ordinary non-question response.
- `create_topic`: creates a structured plan proposal. `/new` applies it
  immediately; otherwise it waits for confirmation. An active topic blocks a
  different subject unless `/new` was used.
- `update_topic`: changes focus within the active topic. Authorized `/update`
  and exact advance requests apply it immediately; other natural-language
  changes wait for proposal confirmation.

If no tool is needed, the tutor returns text directly. A committed plan change
returns its authoritative plan/update parts. Otherwise the response consists
of tutor text plus any options. The response path repairs invalid LaTeX and
Mermaid before persistence; streamed deltas are provisional and `run.ended`
contains the authoritative parts. Failed persistence produces a failed
terminal event, while cancellation produces a cancelled event.

Only after a successful response is persisted does background work summarize
and index the exchange for memory. Topic summaries are refreshed at the
configured 20-message cadence and do not block the response. The shared
`packages/chat-contract` package defines the request, event, message-part,
proposal, and command schemas; clients use a reducer that rejects stale run
events.
