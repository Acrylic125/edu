import { z } from "zod"
import { ProviderIdSchema } from "../shared/contracts"
import codexIcon from "./assets/providers/codex.svg"
import claudeIcon from "./assets/providers/claude.svg"
import antigravityIcon from "./assets/providers/antigravity.png"

const providerIcons = {
  codex: codexIcon,
  claude: claudeIcon,
  antigravity: antigravityIcon,
}

export function ProviderIcon({ provider, className }: {
  provider: z.infer<typeof ProviderIdSchema>
  className: string
}) {
  return <img src={providerIcons[provider]} alt="" className={`${className} ${provider === "codex" ? "dark:brightness-0 dark:invert" : ""}`} />
}

