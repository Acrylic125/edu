# Tutor evaluations

This directory contains semantic evaluations for model-generated tutor output.
They are separate from deterministic unit and flow tests under `src/`.

## Structure

```text
evals/
  correctness-relevance/
    cases.ts       Curated learner inputs, context, references, and criteria
    rubric.ts      Structured correctness/relevance judge contract
    cases.test.ts  Dataset integrity and coverage checks
src/chat/
  route.e2e.test.ts  Mocked orchestration flow with no external model or database
```

## Test layers

1. Unit tests cover deterministic parsing, routing heuristics, and schemas.
2. The mocked flow test covers one complete `handleChat` turn: load context,
   classify intent, stream a response, emit progress, and complete the run.
3. Semantic evaluations run real tutor outputs against the curated cases and
   score correctness and relevance using `TutorEvaluationSchema`.
4. A human should review a sample of failures and borderline scores to calibrate
   the model judge.

## Pass criteria

A response passes when correctness and relevance are both at least 4/5 and it
contains none of the case's disallowed claims. Correctness is a hard gate: high
relevance cannot compensate for a materially wrong answer.

Run fixture and application tests with:

```sh
pnpm test
```

The semantic runner should be added when its execution model is chosen. Keep it
separate from `pnpm test` because it makes paid, nondeterministic model calls.
