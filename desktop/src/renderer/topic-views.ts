import { create } from "zustand"
import { z } from "zod"
import { IdSchema } from "../shared/contracts"

export const stagingId = "staging"
const TopicHistorySchema = z.array(z.union([IdSchema, z.literal(stagingId)]))
const storageKey = "edu:topic-view-history"

export function createTopicViews(storage?: Pick<Storage, "getItem" | "setItem">) {
  let history: z.infer<typeof TopicHistorySchema> = []
  try {
    const raw = storage?.getItem(storageKey)
    if (raw) history = TopicHistorySchema.parse(JSON.parse(raw))
  } catch {
    // Invalid or unavailable storage must not prevent opening the workspace.
  }
  const store = create<{
    activeId?: string
    history: z.infer<typeof TopicHistorySchema>
    select: (id?: string) => void
    reconcile: (ids: string[]) => void
  }>((set, get) => ({
    activeId: undefined,
    history,
    select: (id) => {
      if (!id) {
        set({ activeId: undefined })
        return
      }
      set({ activeId: id, history: [id, ...get().history.filter((item) => item !== id)] })
    },
    reconcile: (ids) => {
      const current = get()
      const available = new Set([...ids, stagingId])
      const history = [...new Set(current.history)].filter((id) => available.has(id))
      let activeId = current.activeId
      if (activeId && !available.has(activeId)) activeId = history[0]
      if (history.length === current.history.length) {
        if (activeId !== current.activeId) set({ activeId })
        return
      }
      set({ activeId, history })
    },
  }))
  store.subscribe((state, previous) => {
    if (state.history === previous.history) return
    try {
      storage?.setItem(storageKey, JSON.stringify(state.history))
    } catch {
      // Topic navigation remains usable when storage is full or disabled.
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
export const useTopicViews = createTopicViews(storage)
