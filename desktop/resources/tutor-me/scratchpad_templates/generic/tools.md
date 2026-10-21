# Tools

## State management backend
The `scratchpad.state.json` is managed by a StateService which are exposed as tool calls for the agent. Each call requires a Mutex for a given change.

Generic state stores `name` and `references` only. It has no thread list. Writers do not record the thread.

### Tutor Agent Tools
`getReferences(genericId)` -> Reference[]
  - Call only when citing a source on this scratchpad OR explicitly asked
`addReference(genericId, reference)` -> None
  - Call only when a source is added after the scratchpad exists
  - Appends the reference (WRITES)
`createGeneric(Generic without createdAt)` -> None
  - Call only when a generic scratchpad is EXPLICITLY created / asked to be created
  - Creates the `{genericId}` folder, comprising of: `scratchpad.md`, `scratchpad.state.json`, `assets` (WRITES)
