# LangGraph and Phoenix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use LangGraph to orchestrate existing agent runners and spool Phoenix OTLP for manual export.

**Architecture:** A shared StateGraph coordinates agent, tools, validation, recovery, and finish nodes. Provider protocols and SQLite persistence remain intact. Explicit OpenTelemetry context connects main-process and worker spans; a file exporter emits OTLP protobuf for a portable Python uploader.

**Tech Stack:** TypeScript, LangGraph, OpenTelemetry, OpenInference, Python/uv, Docker Compose, Phoenix.

**Spec:** `docs/superpowers/specs/2026-10-17-langgraph-phoenix-design.md`

## Global Constraints

- Codex, Claude Code, and Antigravity remain agent runners.
- Preserve current uncommitted work; do not commit without instruction.
- Resolve all filesystem paths at runtime; writes go under the active workspace.
- Preserve provider sessions, save checks, deadlines, and existing diagnostic privacy.
- Python exporter performs uploads only when explicitly invoked.

## Review Focus

- Native agent failures must propagate without duplicate model requests.
- Concurrent workers must produce distinct files and correct parent contexts.
- Commit failure, stop, and timeout must close the parent span as an error.
- Partial collector rejection must remain retryable; endpoint checkpoints must be independent.
- Packaged exporter resources must remain accessible outside ASAR.

### Task 1: Graph orchestration

**Files:** `desktop/src/runners/graph.ts`, provider adapters, `desktop/tests/graph.test.ts`.
**Interfaces:** `runAgentGraph` consumes provider step/tool/recovery/finish callbacks; returns the provider's validated result.
- [x] Write graph tests for tool cycling, repair, limits, runner errors; observe failure.
- [x] Add LangGraph and implement graph routing; refactor all adapters to invoke it.
- [x] Run graph and existing tutor/Codex/CLI tests and typecheck.

### Task 2: File tracing and lifecycle

**Files:** `desktop/src/runners/telemetry.ts`, manager/worker/session/contracts, telemetry and manager tests.
**Interfaces:** turn telemetry exposes context, scoped spans, and finish; worker job carries directory and parent span context.
- [x] Write failing tests for OTLP parentage, privacy, and lifecycle errors.
- [x] Implement atomic protobuf export, graph/agent/tool spans, and main/worker context propagation.
- [x] Verify tests, including concurrent and failed turns; preserve diagnostic failures without blocking saves.

### Task 3: Exporter and local Phoenix

**Files:** top-level `phoenix/` exporter, README, Compose, Python tests; Electron packaging config and desktop docs.
**Interfaces:** `uv run export_traces.py --source PATH --endpoint URL`; endpoint-scoped replay checkpoints.
- [x] Write failing exporter tests for upload, repeat, rejection, malformed data, and endpoint changes.
- [x] Implement exporter and package it outside ASAR; add the exact requested README structure.
- [x] Provision isolated Phoenix; verify health and synthetic ingestion, without replaying real traces.
- [x] Run full unit suite, typecheck, build, Python tests, and review the final changes.

## Execution ledger

Ruling: Implement inline in the current checkout and proceed through the plan without further approval gates, following the user's explicit instruction to proceed. Existing work must be preserved. No commits or worktrees are created.

Pre-flight: graph callbacks are shared by all adapters; telemetry context is shared across manager/worker contracts; OTLP protobuf serialization is shared with the Python decoder.

Task 1: complete. Graph tests and existing tutor/Codex/CLI protocol tests pass.
Task 2: complete. OTLP serialization, concurrent context, Codex tool parentage,
runtime path propagation, private error handling, and file failure tests pass.
Task 3: complete. Local Phoenix is provisioned and manual export verified.

Final review: independent reviewer found inherited LangSmith auto-tracing,
fatal optional exporter-copy errors, and non-OTLP success acknowledgments.
Each was reproduced in a failing test. Disabled inherited tracing in the dedicated
runner process, made copy failures diagnostic, validated response media types,
and caught protobuf JSON ParseError. All regression tests then passed.

Packaging verification found LangGraph's auto-installed @langchain/core peer was
missing from ASAR. Added it as a direct production dependency; the packaged native
Claude/Antigravity worker smoke test then passed, including spool files and scripts.

Known baseline: the unit suite already failed generated-topic titleGenerated
before this task. Existing app.smoke.ts tests expect the workspace/settings before
provider setup; the current onboarding screen blocks those old assumptions. The
new packaged native smoke uses the bridge and verifies the affected runner flow.

Final verification: 75 focused TypeScript tests pass; all 9 Python exporter tests
pass; typecheck, production build, unsigned packaging, and final packaged native
Claude/Antigravity smoke pass. Synthetic LangGraph traces and error status are
read back from Phoenix; replay checkpoints skip a second upload. Full unit suite:
188 pass, 2 skipped, 1 known baseline titleGenerated failure. Existing UI smoke:
5 fail on onboarding expectations. No real tutoring traces were uploaded.
