# Evaluate current difficulty memory

Use this guide for a requested evaluation of the memory design, not as extra work after each tutoring answer. This is a proposed custom protocol, not VikingMem's published evaluation. The target is a justified assessment of current learning needs, not access to the learner's unobservable true mastery.

## Build sequential reference cases

Start with a small human-reviewed pilot, for example 30–50 multi-turn cases. Expand according to observed failures rather than treating that count as a statistical sufficiency claim. Include first misconceptions, repeated misconceptions, distinct issues, clarification, tutor error, assisted answers, independent improvement, recurrence, and unrelated topics.

Each case contains:

```text
caseId, learnerId, topicId
initial entity
timestamped interaction sequence with stable evidence IDs
expected difficulties and allowed statuses after each evaluated interaction
expected evidence links and prohibited inferences
fixed next-user prompts for downstream response comparison, when applicable
```

Define expected states from the conversation prefix available at each step. A later successful answer cannot justify resolving a difficulty earlier. Agree the status policy before comparing configurations. Allow multiple defensible summaries/statuses when evidence is ambiguous, or flag the case for human review.

Illustrative reference transitions:

| Observation | Expected constraint |
|---|---|
| Incorrect operator placement | Represent that specific difficulty with supporting evidence |
| Same misconception repeated | One current issue with both evidence links |
| A different misconception | Preserve both distinct issues |
| Tutor explains the answer | Preserve the learning need unless there is additional learner evidence |
| Learner repeats an exposed answer | Mark assistance; claim no independent mastery |
| Independent correct application | Record scoped improvement under the agreed status policy |
| “What does SUM mean?” | Infer no false belief; record a learning need only if supported |
| Tutor incorrectly explains SUM | Attribute the correction to the tutor |
| Another learner/topic has a similar issue | Keep ownership and evidence isolated |

Human reviewers should settle expected assessments using the skill's evidence rules. Model-generated fixtures require review before becoming reference answers. Hold out some cases, learners, or topics from prompt tuning. Run evaluation in an isolated workspace rather than rewriting live study records.

## Replay and measure state quality

Replay interactions in order, saving a state snapshot after each evaluated update. Match predicted and reference difficulties by stable concept identity or reviewed semantic equivalence, with one-to-one matching. Compare meanings, not exact summary wording. Preserve duplicate predictions as errors rather than letting them inflate recall.

For difficulty precision/recall, compare active learning needs; exclude retained `resolved` entries from both sets. Evaluate those resolved entries through status and evidence metrics. Report results by status so an unresolved issue incorrectly marked resolved appears as missed active need as well as a status error.

Report counts and denominators alongside these metrics:

| Metric | Definition |
|---|---|
| Difficulty precision | Supported, correctly matched predicted difficulties / all predicted difficulties |
| Difficulty recall | Correctly represented expected difficulties / all expected difficulties |
| Difficulty F1 | Harmonic mean of difficulty precision and recall |
| Status-transition accuracy | Updates with an allowed, evidence-supported resulting status / evaluated status decisions |
| Premature resolution rate | Unsupported decisions to mark an issue resolved / all decisions to mark an issue resolved |
| Evidence support rate | Assessment claims supported by their cited prefix evidence / all assessment claims |

Difficulty F1 is concept-set F1, not answer token-overlap F1. State quality includes status and evidence, so F1 alone is insufficient. For zero denominators, report the metric as not applicable and report counts; separately report correct empty-state cases and spurious difficulties. Repeated unchanged `resolved` entries are not new resolution decisions.

Inspect topic/learner leakage and mistaken attribution of tutor errors separately. Break results down by transition type so common easy cases do not hide failures on assistance, recurrence, or resolution. An end-of-conversation score alone can hide earlier false diagnoses.

## Judge rubric

Provide the judge with the conversation prefix, previous state, candidate state, reference concept assessments/allowed statuses, and evidence IDs. Keep evaluator keys separate from learner-facing questions. Use item-level decisions rather than one unexplained score:

```text
For every predicted difficulty:
  Is it owned by the correct learner and topic?
  Does its concept match an expected learning need?
  Does cited learner evidence support its summary and status?
  Is the claimed independent/assisted performance classification supported?
  Is it distinct from the other predicted entries?

For every expected difficulty:
  Is an equivalent assessment represented in the candidate state?

For each changed status:
  Is the transition allowed by the reference policy and prefix evidence?

Return YES / NO / UNCERTAIN with relevant evidence IDs and a short reason.
```

Calibrate judge decisions against a human-reviewed subset. Send uncertainty and substantive disagreement for review; report their counts rather than silently treating them as correct. Freeze the rubric, judge version, update model, and generation settings for a comparison. Repeat runs when stochastic updates could materially change conclusions; report variability, not just the best run.

## Compare update mechanisms and the full pipeline

To isolate merging, compare direct LLM entity editing with configured `LLM_MERGE` using the same initial entity, validated event sequence, update model, and agreed evidence policy. Replay each configuration's own evolving state so accumulated drift is measured. Control retrieval for this comparison; record any differences in prompts or available context.

Then replay raw conversations through extraction, routing, updating, and retrieval. Compare this full pipeline with the merge-only results to locate extraction or ownership errors. Benchmark improvement must be measured; a named operator is not itself evidence of superiority.

## Measure downstream tutoring usefulness

At fixed checkpoints, give the tutor the same next-user input and recent conversation under:

- No persistent difficulty memory.
- Difficulty memory produced by direct editing.
- Difficulty memory produced by `LLM_MERGE`.

Use the same tutor model and task constraints. Randomize response order and hide configuration labels from reviewers. Judge whether each response targets a supported learning need, reflects latest demonstrated improvement, avoids fabricated deficits, and provides an appropriate next teaching action. If evaluating retrieval separately, compare selected context against the relevant state/evidence; hold the updater fixed when comparing primary-only with primary-plus-auxiliary retrieval.

Replay measures response usefulness, not causal learning improvement. To test actual learning, compare learner outcomes in an appropriately randomized trial using fresh transfer questions and a delayed retention assessment, with comparable starting knowledge and practice exposure. Repeating an already explained question does not establish transfer.

## Operational measurements and decision

Record update p50/p95 latency, tokens and cost per update, stored memory size, retrieval p50/p95 latency, and memory tokens passed to the tutor. Measure full-response latency separately from ingestion and retrieval. Report input lengths and model/settings; compare costs for the same replayed workload.

Choose acceptance criteria for the intended use before examining final results. Report state quality, downstream response quality, and cost separately; do not bury false resolutions in an average. The minimum useful report includes configuration, case counts, per-transition metrics, supported failure examples, latency/cost, and whether the configured merge improved on direct editing. No learning-gain claim follows from state or judge scores alone.
