import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"

function loadVars(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) values[match[1]] = match[2]
  }
  return values
}

const args = process.argv.slice(2)
const reset = args.includes("--reset")
const forwarded = args.filter((arg) => arg !== "--reset" && arg !== "--")
let vars = {}
try {
  vars = loadVars(await readFile("../backend/edu-api/.dev.vars", "utf8"))
} catch {
  // The process environment can provide secrets in CI.
}

const apiKey = process.env.OPENROUTER_API_KEY ?? vars.OPENROUTER_API_KEY
if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY is required for real-LLM E2E tests")
}

const child = spawn(
  "pnpm",
  ["exec", "playwright", "test", "--config", "playwright.config.ts", ...forwarded],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...vars,
      OPENROUTER_API_KEY: apiKey,
      E2E_RESET: reset ? "1" : "0",
    },
  },
)

const stop = () => {
  if (child.exitCode === null) child.kill("SIGINT")
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
