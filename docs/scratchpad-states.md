# Scratchpad States

This document defines how EdU reconciles missing scratchpad files.

## How to reconcile missing files?

These rules apply after scratchpad creation has completed and while the scratchpad directory still exists. Staging is outside this document's scope.

EdU rechecks scratchpad files when its window regains focus. The viewed scratchpad and selector update to reflect external file changes.

For the table below, "Exists" means:

- `scratchpad.md`: the file exists. Its contents do not need to pass validation.
- `scratchpad.state.json`: the file exists and parses successfully against the scratchpad state schema. A missing file, invalid JSON, or a schema validation failure counts as "No".

| Order | scratchpad.md Exists | scratchpad.state.json Exists | Result |
| --- | --- | --- | --- |
| 1 | Yes | Yes | Show the scratchpad as is. |
| 2 | No | Yes | Show the scratchpad entry in an error state. The scratchpad panel displays **ERROR! Missing scratchpad.md** and a **Regenerate** button. |
| 3 | Yes | No | Show the scratchpad entry in an error state. Display the existing Markdown with a banner that offers conversion to a Generic Scratchpad. |
| 4 | No | No | Show the scratchpad entry in an error state. Display **Missing scratchpad.md** and **Cannot reconcile scratchpad, missing scratchpad.state.json**. No recovery action is available. |

### 1. Both files exist

Show the existing scratchpad entry and its normal scratchpad panel.

### 2. Markdown is missing and state is valid

Keep the scratchpad entry visible in an error state. Use the normal scratchpad layout, with the following content in the scratchpad panel:

- Error message: **ERROR! Missing scratchpad.md**
- Button: **Regenerate**

The **Regenerate** button recreates `scratchpad.md` from the valid state file for Topic and Test scratchpads. Generic state files contain references rather than document content, so Generic scratchpads use their latest saved Markdown. If no saved Markdown is available, regeneration creates a title-only document.

### 3. Markdown exists and state is missing

Keep the scratchpad entry visible in an error state, similar to a Staging entry. Display the existing Markdown in the normal scratchpad panel layout.

Show this banner:

> Scratchpad state file is missing. We cannot recover this. Convert to Generic Scratchpad?

Provide a **Convert to generic scratchpad** button in the banner. The button converts the scratchpad to a Generic Scratchpad, preserves its Markdown content, and creates a valid `scratchpad.state.json`.

This case also applies when the state file exists but fails validation.

### 4. Both files are missing after creation

Keep the completed scratchpad entry visible in an error state. The scratchpad panel displays:

- **Missing scratchpad.md**
- **Cannot reconcile scratchpad, missing scratchpad.state.json**

The scratchpad cannot be recovered. Do not offer a **Regenerate** or **Convert to generic scratchpad** button.

This case also applies when `scratchpad.md` is missing and the state file exists but fails validation.
