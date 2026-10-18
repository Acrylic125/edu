import { create } from "zustand"
import { persist } from "zustand/middleware"
import { z } from "zod"
import { RunnerSchema } from "../shared/contracts"

const FavoriteSchema = z.object({
  provider: RunnerSchema.shape.provider,
  model: RunnerSchema.shape.model,
})
const PreferencesSchema = z.object({ favorites: z.array(FavoriteSchema) })

export const useModelPreferences = create<{
  favorites: z.infer<typeof FavoriteSchema>[]
  toggleFavorite: (favorite: z.infer<typeof FavoriteSchema>) => void
}>()(
  persist(
    (set) => ({
      favorites: [],
      toggleFavorite: (favorite) => set((state) => {
        const exists = state.favorites.some(
          (entry) => entry.provider === favorite.provider && entry.model === favorite.model,
        )
        if (exists) {
          return { favorites: state.favorites.filter(
            (entry) => entry.provider !== favorite.provider || entry.model !== favorite.model,
          ) }
        }
        return { favorites: [...state.favorites, favorite] }
      }),
    }),
    {
      name: "edu-model-preferences",
      partialize: (state) => ({ favorites: state.favorites }),
      merge: (stored, current) => {
        const parsed = PreferencesSchema.safeParse(stored)
        if (!parsed.success) return current
        return { ...current, favorites: parsed.data.favorites }
      },
    },
  ),
)
