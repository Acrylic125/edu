# Isolated real-model E2E plan

The E2E harness runs the web app and `edu-api` against a private Wrangler state directory. Better Auth is enabled with a generated test account, while the application still uses the real OpenRouter model. The D1, Durable Object, and R2 state is never the development state.

## Running

```bash
pnpm test:e2e                 # reuse compatible checkpoints
pnpm test:e2e -- --reset      # rebuild every checkpoint from a fresh database
pnpm e2e:dev                  # Playwright UI mode
```

Checkpoints are immutable branch bases stored under `.e2e/checkpoints`; each test clones its selected base into a per-test state directory. The graph is:

```text
FRESH -> SETUP_PLAN_TOC -> SUBTOPIC_1 -> SETUP_PLAN_CALCULUS
                 \-> independent branch tests
```

`SETUP_PLAN_TOC` validates the complete Automata and Regular Languages outline as JSON. `SUBTOPIC_1` is created after the first explanation exposes Practice and Continue actions. `SETUP_PLAN_CALCULUS` validates the complete supplied Calculus I–III outline as JSON.

## Response checks

Every assistant response is observed over WebSocket and persisted-message reloads. `validateSafety` rejects configured secrets and common token/private-key formats; `validateLaTeX` renders delimited math with KaTeX; `validateMermaid` parses every Mermaid fence in strict mode. Semantic checks use `z-ai/glm-5.3-flash` through OpenRouter and require a structured passing verdict.

## Covered branches

- Explicit and confirmed plan updates, including P vs NP, 3-SAT, and Vertex Cover.
- Plan selection followed by a current-topic question.
- Rejected irrelevant Derivatives update.
- First-topic explanation with Practice/Continue actions.
- Next-topic progression and six distinct practice questions, judged for semantic uniqueness.
- New calculus plan creation and a judged summary of all five supplied areas.
