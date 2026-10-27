# edu test creator plan

## Scope and resources

- Repository: `/Users/benedicttan/Desktop/projects/edu`.
- Read `workpad/2_EXPLORE_INDEX.md`, `workpad/edu.md`, the test-creation skill, and `REPO_TEST_CREATOR_TEMPLATE.md`.
- Add exactly one regression in `desktop/src/main/tutor-workflow.test.ts`; reuse its real workspace fixture and workflow APIs. Do not modify implementation or existing tests.
- This test covers host-duration forwarding and durable publication. The existing Electron Retry regression covers the host's elapsed-time source; the parent already ran that red and will verify it after the fix.

## Scenario implemented

1. Start the fixture's fractions turn and save its learning handoff.
2. Dispatch `saveReply` for `One half is 1/2.` with host duration `1250` via the planned third dispatcher argument.
3. Complete the turn, then dispatch the same save with a later host duration `2500`.
4. Reopen the workspace from disk and complete the saved turn through a fresh workflow repository.
5. Assert the duplicate returns the original receipt, reopening preserves the receipt and message identity, exactly one assistant message exists, and both completed and reopened messages retain duration `1250`.

The duplicate uses a different duration to detect accidental overwrites. The test injects a known host duration at the dispatcher boundary; it does not claim to verify elapsed-time measurement.

## Validation evidence

Command:

```sh
pnpm --dir desktop exec tsx --test --test-name-pattern='a reply retains its host duration' src/main/tutor-workflow.test.ts
```

- Before the parent fix: exit code **1**, tests **1**, passed **0**, failed **1**, skipped **0**.
- Observed: reopened assistant `durationMs` is `undefined`; expected: `1250`.
- Receipt equality, single assistant message, and message identity assertions ran successfully before the duration assertion failed.
- The assertion remains enabled. No suppression or implementation changes were made.
- The parent will add optional `durationMs` as dispatcher argument three and repository `saveReply` argument five, then forward it into the persisted message. Until that API lands, TypeScript also sees the intentionally pending third argument; the normal `tsx` test runner executes the regression and exposes the missing duration.

## Relevant rules

- Reused the existing fixture, repository APIs, and inferred types; added no abstractions or `any`/`unknown`.
- Used `pnpm` for execution.
- Included the test template's requested brief fixture explanation and a comment explaining the replay contrast.
