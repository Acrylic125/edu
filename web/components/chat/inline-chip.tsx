import { cn } from "@/lib/utils"

const INLINE_CHIP_GEOMETRY =
  "inline-flex h-[1.41em] max-w-full items-center gap-[0.33em] rounded-[0.5em] px-[0.5em] font-medium leading-none align-middle"

export const COMPOSER_SKILL_CHIP_CLASS_NAME = cn(
  INLINE_CHIP_GEOMETRY,
  "select-none border border-fuchsia-500/25 bg-fuchsia-500/12 text-[0.86em] text-fuchsia-700 dark:text-fuchsia-300"
)

export const CHAT_SKILL_CHIP_CLASS_NAME = cn(
  INLINE_CHIP_GEOMETRY,
  "border border-fuchsia-500/25 bg-fuchsia-500/12 text-[12px] text-fuchsia-700 dark:text-fuchsia-300"
)

export const SKILL_CHIP_ICON_CLASS_NAME =
  "block size-[1.17em] shrink-0 self-center opacity-85 [&>svg]:block"

export const SKILL_CHIP_LABEL_CLASS_NAME = "truncate leading-tight"

export const SKILL_CHIP_ICON_SVG = `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`
