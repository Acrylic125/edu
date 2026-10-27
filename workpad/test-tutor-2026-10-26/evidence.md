# EdU native UI validation — 2026-10-26

## Scope and method

Used the development Electron app only through `cua_repl` native computer use. Read `.agents/skills/test-tutor/SKILL.md`, `desktop/README.md`, and locally extracted PDF text for lecture pages 5–16 and Tutorial 6. Kept the tutor model at GPT-6.1-Sol (UI showed Low/default effort). No app API, database, fixtures, or scripted provider used.

## Topic and sources

Created one new topic through the visible `/new-topic` flow. The sidebar showed **Vector spaces, subspaces, and span**. No topic ID was exposed in the UI tree. Source-linked plan visibly listed the requested lecture sections in order:

1. 6.1 Vector spaces, pages 5–11
2. 6.2 Subspaces, pages 12–14
3. 6.3 Subspace spanned by a set, pages 15–16

Both lecture and Tutorial 6 PDFs were visible as attached files. The lesson's topic directory showed those three source page ranges. The tutorial attachment did not appear as an explicit lesson citation during the reached section.

## Visible progress

Completed plan confirmation and entered **6.1 Vector spaces**. EdU presented the definition (nonempty set, vector addition, real scalars, ten rules), closure under addition, and a robot-displacement example with coordinate addition and a plot. It linked lecture page 5.

At understanding checks, the learner first gave vague responses. The tutor responded with a focused counterexample for `x ≤ 2`, then used universal-coordinate reasoning for `x ≤ 0`, distinguished two coordinate restrictions for `x ≤ 0, y ≤ 2`, and corrected the inequality direction for `x ≤ 0, y ≤ −1`. It continued through commutativity and associativity with ordinary coordinate-wise addition, and invented operation comparisons. Source-linked feedback remained on page 5.

**Reached part:** 6.1 only. **Completed parts:** none confirmed. No visible end-of-part-one marker or transition to 6.2 occurred, so parts 6.2 and 6.3 are not claimed reached.

## Latency and recovery

Durations visible in the UI (send-to-visible-response approximated by turn timing; EdU's displayed response duration recorded where available):

- Plan response: 21.5 s displayed.
- Initial 6.1 lesson: 54.2 s displayed.
- Vague closure answer → correction and new check: 27.7 s displayed.
- General closure reasoning response: 154.0 s displayed; UI then showed a stopped turn. Visible Retry recovered it; resumed response took 31.4 s.
- Downward-inequality check response: 50.1 s displayed.
- Vague answer about custom subtraction operation: 40.1 s displayed.
- Associativity explanation and next custom-operation check: 42.9 s displayed.
- Custom operation prompt response: 40.5 s displayed.
- Commutativity answer response timed out after several minutes with visible text: “The runner timed out. Retry with a smaller request.” Visible Retry restarted source reading and then produced the explanation in 49.4 s.
- After an associativity-check reply, a further tutor response stayed at “Preparing your lesson with Codex” for over three minutes, then displayed the same runner timeout and Retry control. Retrying re-read the lecture, but the computer-use bridge then failed before the result could be inspected.

Native UI bridge recovery attempts: exact development Electron app path returned `server error -10005: cgWindowNotFound` twice; app inventory still listed Electron processes but had no usable target window. No restart was attempted.

## Evidence limitations

Native screenshots could be viewed in-session, but the available computer-use interface did not expose a supported save-to-file method. This log records the visible UI evidence; no screenshot artifacts were saved. UI evidence does not establish model invocation counts. The user-facing topic's displayed name differs from the requested seed name because EdU auto-titled it from the topic plan.

## Parent review

After the child returned, the parent rebound to the exact development Electron app path successfully. The app process remained running, and the chat displayed the recovered associativity response with a duration of 47.3 s. The native window error was temporary and does not establish that EdU crashed.

The parent selected **Vector spaces, subspaces, and span** in the sidebar and inspected that topic's saved walkthrough. The saved closure explanation used the learner's wording about each vertical number already being -1 or lower and two movements going even lower. The operation example also retained the learner's explanation that the result depends on which movement comes second because its vertical number is doubled. These observations support partial validation of learner-authored wording and a consistent robot story.

The pending check still concerned associativity in section 6.1. No completion of part one or transition to parts two or three was visible. Repeated slow responses and timeouts prevent a passing reliability result. Source coverage across all three parts, later practice, and the complete learning flow remain unvalidated. The test topic and progress were preserved.

## Continuation — associativity probe

Rebound to the exact development Electron app path and confirmed the selected topic and saved progress remained intact. The pending check asked whether (a,b) ★ (c,d) = (a+c,b−d) becomes associative when w's vertical coordinate is zero, and whether that special case proves associativity. Learner refinement: “If w’s vertical part is zero, I think the two results would match because subtracting zero does not change anything. But I guess that only checks this kind of w; associativity has to work for any third move, and the earlier w with vertical part 3 showed a case where it did not.” This was sent once. UI showed the response preparing, then “Reading tutoring guidance”; no completion/response duration visible yet. Continue observing before retrying or sending anything else.

The associativity refinement received a focused response (48.3 s visible): the tutor affirmed zero vertical contribution agrees only in that restricted case, and contrasted with prior counterexample. It then introduced the zero-vector axiom and asked whether T can contain a do-nothing movement despite closure. First answer sent once: “I think maybe it could, since T is closed under addition, but I’m not sure what the movement that does nothing would be.” Tutor run is preparing. Part 1 still not visibly completed.

The zero-vector check received a concrete tutor explanation (visible response around 48 s): closure alone does not guarantee the zero vector; ordinary addition requires (0,0), which is not in T because its vertical coordinate is not ≤ −1. Follow-up then tested W = {(x,y): x ≤ 0}. Vague initial answer sent once: “I guess it might, because there is no limit on the vertical part, so maybe some movement can leave everything unchanged.” That response is still preparing. No part boundary is visible yet.

Additional visible zero-vector teaching: for W (x ≤ 0), the tutor explained (0,0) belongs and leaves any movement unchanged (35.6 s), with emphasis that equality includes the boundary. The next strict subset W′ (x < 0) check received a vague initial response: “I think probably not, since taking away the boundary might remove the one movement that does nothing, but I’m not certain.” Sent once; tutor is preparing. Part 1 remains in progress.

## Bridge termination during continuation

The lesson had advanced to axiom 5 and the tutor visibly asked whether W contains the inverse of u = (−2,1). A vague student response was drafted in the composer, but before it could be sent the native tool reported: “The user changed … Electron.app. Re-query the latest state with `get_app_state` before sending more actions.” Inventory refresh showed the development Electron process was no longer present. Rebinding the exact development path returned `server error -10005: App quit`; resetting the CUA session and rebinding then opened Electron's default app page (file:///…/default_app.asar/index.html), not EdU. No more app actions were taken. Saved topic/progress remains on disk, but part 1 has not visibly ended; parts 2–3 and end-of-part-3 evidence are not reached. No follow-up was sent for the inverse prompt.
