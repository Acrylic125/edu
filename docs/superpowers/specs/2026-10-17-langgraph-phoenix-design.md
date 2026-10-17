# LangGraph orchestration and local Phoenix tracing

Approved direction: LangGraph acts only as orchestrator. Codex, Claude Code,
and Antigravity remain agent runners, retaining their existing protocols and
EdU tool restrictions. OpenRouter remains supported. The user authorized
implementation and local Phoenix provisioning after reviewing the in-chat design.

The graph owns runner invocation, requested EdU tool batches where applicable,
validation, bounded repair attempts, and completion. Codex retains its native
agent loop and resumable threads; its dynamic tool calls execute inside that
runner. No model is replaced with a LangChain chat model. Existing plan approval,
private-key checks, stale-topic checks, and SQLite transactions remain enforced.
Graph state is per turn; committed EdU state remains the recovery authority.

OpenTelemetry spans use Phoenix OpenInference semantics. A main-process turn span
parents worker graph, runner, and tool spans through explicit serialized context.
Trace files are OTLP protobuf requests written atomically into the runtime
workspace's phoenix/ directory. Trace files contain operational metadata, never
prompts, learner replies, answer keys, credentials, or raw tool arguments.
Tracing failures are reported through diagnostics without undoing committed work.

The top-level phoenix/ directory contains a portable uv Python exporter and README.
It accepts a trace source directory and collector endpoint, validates protobuf,
uploads only on explicit invocation, and checkpoints successful uploads per endpoint.
Failures and partial rejection must not be checkpointed. The exporter is copied
outside ASAR into packaged resources for use from an installed app.

Local Phoenix uses the official arizephoenix/phoenix image, a pinned digest,
Compose-scoped persistent storage, and a Docker-assigned localhost HTTP port.
No provider credentials or model requests are required for verification.

Verification covers graph branches/limits, existing provider fixtures, trace
parentage and privacy, failed-turn spans, exporter retry/checkpoint behavior,
packaged resource inclusion, and actual Phoenix ingestion using synthetic data.
