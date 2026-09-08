import { spawn, type ChildProcess } from "node:child_process"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"

const repoRoot = path.resolve(process.cwd(), "..")
const backendRoot = path.join(repoRoot, "backend", "edu-api")
const backendVarsPath = path.join(backendRoot, ".dev.vars")
const webEnvPath = path.join(process.cwd(), ".env")

type Service = {
  process: ChildProcess
  logPath: string
}

export type RunningServices = {
  stateDir: string
  api: Service
  web: Service
}

function parseEnvFile(text: string) {
  const values = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!match) continue
    values.set(match[1], match[2])
  }
  return values
}

async function loadLocalSecrets() {
  const values = new Map<string, string>()
  for (const filename of [backendVarsPath, webEnvPath]) {
    try {
      const parsed = parseEnvFile(await readFile(filename, "utf8"))
      for (const [key, value] of parsed) values.set(key, value)
    } catch {
      continue
    }
  }
  return values
}

async function startProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  logPath: string,
) {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" })
  await mkdir(path.dirname(logPath), { recursive: true })
  child.stdout?.on("data", (chunk: Buffer) => void appendFile(logPath, chunk))
  child.stderr?.on("data", (chunk: Buffer) => void appendFile(logPath, chunk))
  return { process: child, logPath }
}

async function waitFor(url: string) {
  const deadline = Date.now() + 120_000
  let lastError = ""
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
      lastError = `${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`)
}

export async function applyMigrations(stateDir: string) {
  const result = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["exec", "wrangler", "d1", "migrations", "apply", "edu-api", "--local", "--persist-to", stateDir],
      { cwd: backendRoot, env: process.env, stdio: "inherit" },
    )
    child.on("error", reject)
    child.on("exit", (code) => resolve(code ?? 1))
  })
  if (result !== 0) throw new Error(`D1 migration failed with exit code ${result}`)
}

export async function startServices(stateDir: string, artifactDir: string) {
  const secrets = await loadLocalSecrets()
  const secret = secrets.get("BETTER_AUTH_SECRET") ?? process.env.BETTER_AUTH_SECRET
  const apiKey = secrets.get("OPENROUTER_API_KEY") ?? process.env.OPENROUTER_API_KEY
  if (!secret || !apiKey) throw new Error("BETTER_AUTH_SECRET and OPENROUTER_API_KEY are required")
  process.env.OPENROUTER_API_KEY = apiKey

  const apiEnv = {
    ...process.env,
    BETTER_AUTH_SECRET: secret,
    OPENROUTER_API_KEY: apiKey,
    WEB_ORIGIN: "http://localhost:3100",
    E2E_MODE: "1",
  }
  const webEnv = {
    ...process.env,
    BETTER_AUTH_SECRET: secret,
    AUTH_D1_LOCAL: "1",
    AUTH_D1_STATE_DIR: stateDir,
    E2E_AUTH_ENABLED: "1",
    NEXT_PUBLIC_E2E_AUTH_ENABLED: "1",
    NEXT_PUBLIC_API_URL: "http://localhost:8789",
    NEXT_PUBLIC_BACKEND_URL: "http://localhost:3100",
    SKIP_ENV_VALIDATION: "false",
  }

  const api = await startProcess(
    "pnpm",
    ["exec", "wrangler", "dev", "--persist-to", stateDir, "--port", "8789", "--var", "WEB_ORIGIN:http://localhost:3100", "--var", "E2E_MODE:1"],
    backendRoot,
    apiEnv,
    path.join(artifactDir, "api.log"),
  )
  const web = await startProcess("pnpm", ["dev", "--port", "3100"], process.cwd(), webEnv, path.join(artifactDir, "web.log"))
  const services = { stateDir, api, web }
  try {
    await waitFor("http://localhost:8789/topics")
    await waitFor("http://localhost:3100/login")
    return services
  } catch (error) {
    await stopServices(services)
    throw error
  }
}

export async function stopServices(services: RunningServices) {
  for (const service of [services.web, services.api]) {
    if (service.process.pid) {
      if (process.platform === "win32") service.process.kill("SIGTERM")
      else process.kill(-service.process.pid, "SIGTERM")
    }
  }
  await Promise.all(
    [services.web, services.api].map(
      (service) =>
        new Promise<void>((resolve) => {
          if (service.process.exitCode !== null) {
            resolve()
            return
          }
          service.process.once("exit", () => resolve())
          setTimeout(() => {
            if (service.process.exitCode === null) {
              if (service.process.pid && process.platform !== "win32") process.kill(-service.process.pid, "SIGKILL")
              else service.process.kill("SIGKILL")
            }
            resolve()
          }, 10_000)
        }),
    ),
  )
}
