import { create } from "zustand"
import { z } from "zod"

const SavedTabsSchema = z.object({
  openIds: z.array(z.string().min(1)).nullable(),
  history: z.array(z.string().min(1)),
})

const storageKey = "edu:chat-tabs"

export function createChatTabs(storage?: Pick<Storage, "getItem" | "setItem">) {
  let knownIds: Set<string> | undefined
  let saved = SavedTabsSchema.parse({ openIds: null, history: [] })
  try {
    const raw = storage?.getItem(storageKey)
    if (raw) saved = SavedTabsSchema.parse(JSON.parse(raw))
  } catch {
    // Invalid or unavailable browser storage must not prevent opening the workspace.
  }

  const store = create<
    z.infer<typeof SavedTabsSchema> & {
      activeId: string
      cycleIds: string[] | null
      reconcile: (ids: string[]) => void
      select: (id: string) => void
      close: (id: string) => void
      cycle: (reverse: boolean) => void
      commitCycle: () => void
    }
  >((set, get) => ({
    ...saved,
    activeId: saved.history[0] ?? "new",
    cycleIds: null,
    reconcile: (ids) => {
      const current = get()
      const available = new Set([...ids, "new"])
      let openIds = current.openIds ?? ids
      if (knownIds)
        openIds = [...openIds, ...ids.filter((id) => !knownIds?.has(id))]
      knownIds = new Set(ids)
      openIds = [...new Set(openIds)].filter((id) => available.has(id))
      const open = new Set(openIds)
      const history = [...new Set(current.history)].filter((id) => open.has(id))
      if (history.length === 0 && openIds.length > 0) history.push(openIds[0])
      let activeId = current.activeId
      if (!open.has(activeId)) activeId = history[0] ?? "new"
      set({
        openIds,
        history,
        activeId,
        cycleIds: current.cycleIds?.filter((id) => open.has(id)) ?? null,
      })
    },
    select: (id) => {
      const current = get()
      const openIds = current.openIds ?? []
      set({
        openIds: openIds.includes(id) ? openIds : [...openIds, id],
        history: [id, ...current.history.filter((item) => item !== id)],
        activeId: id,
        cycleIds: null,
      })
    },
    close: (id) => {
      const current = get()
      let openIds = (current.openIds ?? []).filter((item) => item !== id)
      let history = current.history.filter((item) => item !== id)
      if (openIds.length === 0) openIds = ["new"]
      if (history.length === 0) history = [openIds[0]]
      let activeId = current.activeId
      if (activeId === id) activeId = history[0]
      // Closing during a keyboard cycle commits the surviving selection.
      if (current.cycleIds)
        history = [activeId, ...history.filter((item) => item !== activeId)]
      set({ openIds, history, activeId, cycleIds: null })
    },
    cycle: (reverse) => {
      const current = get()
      // Freeze MRU order until Ctrl is released so repeats reach older chats.
      const cycleIds = current.cycleIds ?? [
        ...new Set([...current.history, ...(current.openIds ?? [])]),
      ]
      if (cycleIds.length < 2) return
      const direction = reverse ? -1 : 1
      const index =
        (cycleIds.indexOf(current.activeId) + direction + cycleIds.length) %
        cycleIds.length
      set({ activeId: cycleIds[index], cycleIds })
    },
    commitCycle: () => {
      const current = get()
      if (current.cycleIds) current.select(current.activeId)
    },
  }))

  store.subscribe((state, previous) => {
    if (
      state.openIds === previous.openIds &&
      state.history === previous.history
    )
      return
    try {
      storage?.setItem(
        storageKey,
        JSON.stringify({ openIds: state.openIds, history: state.history }),
      )
    } catch {
      // Tab navigation remains usable when storage is full or disabled.
    }
  })
  return store
}

let storage: Storage | undefined
try {
  storage = window.localStorage
} catch {
  // Unit tests and non-browser environments have no local storage.
}
export const useChatTabs = createChatTabs(storage)
