import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { CliConnectionSchema } from "../shared/contracts"

export async function prepareCliWorkspace(connection: z.infer<typeof CliConnectionSchema>) {
  await mkdir(connection.directory, { recursive: true, mode: 0o700 })
  if (connection.provider === "antigravity") {
    const agents = join(connection.directory, ".agents", "agents")
    await mkdir(agents, { recursive: true, mode: 0o700 })
    // The CLI has no --tools switch; a dedicated main agent limits native capabilities.
    await writeFile(join(agents, "edu-tutor.md"), `---
name: edu-tutor
description: EdU tutoring response adapter
tools: []
mainAgent: true
subagent: false
commandExecutionPolicy: off
mcpServers: []
skills: []
plugins: []
---
Return the requested structured response. EdU performs all source reads and saves; do not use native tools.
`, { mode: 0o600 })
  }
}

export function runCliCommand(
  connection: z.infer<typeof CliConnectionSchema>,
  args: string[],
  input = "",
  processChanged: (pid: number | null) => void = () => {},
  timeout = 120_000,
  signal?: AbortSignal,
) {
  const { ANTHROPIC_API_KEY: _anthropic, ANTHROPIC_AUTH_TOKEN: _anthropicToken,
    CLAUDE_CODE_OAUTH_TOKEN: _claudeToken, GEMINI_API_KEY: _gemini,
    GOOGLE_API_KEY: _google, ANTHROPIC_BASE_URL: _anthropicUrl,
    GOOGLE_GEMINI_BASE_URL: _geminiUrl, ...environment } = process.env
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("The provider request was canceled."))
      return
    }
    const child = spawn(connection.executable, args, {
      cwd: connection.directory,
      env: environment,
      stdio: "pipe",
      windowsHide: true,
    })
    processChanged(child.pid ?? null)
    let output = ""
    let failure: Error | undefined
    const abort = () => {
      failure = new Error("The provider request was canceled.")
      child.kill()
    }
    signal?.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(() => {
      failure = new Error("The provider timed out. Retry with a smaller request.")
      child.kill()
    }, timeout)
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      if (output.length + chunk.length > 16_000_000) {
        failure = new Error("The provider returned an oversized response.")
        child.kill()
      } else output += chunk
    })
    child.stderr.resume()
    child.stdin.on("error", () => {})
    child.on("error", () => {
      signal?.removeEventListener("abort", abort)
      clearTimeout(timer)
      processChanged(null)
      reject(new Error("Could not start the provider. Check its binary path in Settings → Providers."))
    })
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort)
      clearTimeout(timer)
      processChanged(null)
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error("The provider exited unsuccessfully. Sign in to its CLI, check account access, and retry."))
      else resolve(output)
    })
    child.stdin.end(input)
  })
}

export function cliPromptArguments(connection: z.infer<typeof CliConnectionSchema>, schema: string, model = "default", effort?: string) {
  const args = ["-p", "--output-format", "json", "--json-schema", schema]
  if (connection.provider === "claude")
    args.push("--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--safe-mode", "--no-session-persistence")
  else args.push("--agent", "edu-tutor", "--sandbox", "--print-timeout", "2m")
  if (model !== "default") args.push("--model", model)
  if (effort) args.push("--effort", effort)
  return args
}

export function parseCliResponse(provider: z.infer<typeof CliConnectionSchema>["provider"], output: string) {
  const envelope = z.object({
    is_error: z.boolean().optional(),
    status: z.string().optional(),
    structured_output: z.json().optional(),
    result: z.string().optional(),
    response: z.string().optional(),
  }).parse(JSON.parse(output))
  if (envelope.is_error || (provider === "antigravity" && envelope.status !== "SUCCESS"))
    throw new Error("The provider could not complete this request. Check its CLI account and retry.")
  if (envelope.structured_output !== undefined) return envelope.structured_output
  return z.json().parse(JSON.parse(envelope.result ?? envelope.response ?? ""))
}
