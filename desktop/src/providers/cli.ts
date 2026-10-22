import { spawn } from "node:child_process"
import { access, constants, mkdir, stat, writeFile } from "node:fs/promises"
import { delimiter, isAbsolute, join, resolve } from "node:path"
import { homedir } from "node:os"
import { z } from "zod"
import { CliConnectionSchema, providerDefaultModels } from "../shared/contracts"

export const CliToolServerSchema = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()),
  names: z.array(z.string().min(1)),
})

export async function resolveCliExecutable(provider: z.infer<typeof CliConnectionSchema>["provider"], binaryPath?: string) {
  if (binaryPath) {
    if (!(await stat(binaryPath)).isFile()) throw new Error("The configured CLI is not an executable file.")
    await access(binaryPath, constants.X_OK)
    return binaryPath
  }
  const environment = z.object({ PATH: z.string().default(""), LOCALAPPDATA: z.string().optional(), APPDATA: z.string().optional() }).parse(process.env)
  let name = "claude"
  if (provider === "antigravity") name = "agy"
  const names = [name]
  if (process.platform === "win32") names.unshift(`${name}.exe`)
  // Finder-launched apps do not inherit the user's shell PATH.
  const directories = [
    ...environment.PATH.split(delimiter).filter(isAbsolute),
    join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]
  if (environment.LOCALAPPDATA) directories.push(join(environment.LOCALAPPDATA, "agy", "bin"))
  if (environment.APPDATA) directories.push(join(environment.APPDATA, "npm"))
  for (const directory of new Set(directories)) {
    for (const name of names) {
      const executable = resolve(directory, name)
      try {
        if (!(await stat(executable)).isFile()) continue
        await access(executable, constants.X_OK)
        return executable
      } catch {
        // Missing or inaccessible candidates are expected while searching installations.
      }
    }
  }
  throw new Error(`Install ${provider === "claude" ? "Claude Code" : "Antigravity CLI"}, then click Connect. For a custom installation, set its binary path in provider settings.`)
}

export async function prepareCliWorkspace(connection: z.infer<typeof CliConnectionSchema>, webResearch = false, toolServer?: z.infer<typeof CliToolServerSchema>) {
  await mkdir(connection.directory, { recursive: true, mode: 0o700 })
  if (connection.provider === "antigravity") {
    const agents = join(connection.directory, ".agents", "agents")
    await mkdir(agents, { recursive: true, mode: 0o700 })
    let nativeTools = "finish"
    if (webResearch) nativeTools += ", search_web, read_url_content"
    const mcpServers = []
    if (toolServer) mcpServers.push({ name: "edu", serverUrl: toolServer.url, headers: toolServer.headers })
    let instructions = "Return the requested structured response with finish."
    if (toolServer) instructions = "Use EdU MCP tools for source reads and learning-state changes. Save the private handoff before returning the requested structured reply with finish. Use the available web tools for research."
    await writeFile(join(agents, "edu-tutor.md"), `---
name: edu-tutor
description: EdU tutoring response adapter
tools: [${nativeTools}]
mainAgent: true
subagent: false
commandExecutionPolicy: off
mcpServers: ${JSON.stringify(mcpServers)}
skills: []
plugins: []
---
${instructions}
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
  toolServer?: z.infer<typeof CliToolServerSchema>,
) {
  const { ANTHROPIC_API_KEY: _anthropic, ANTHROPIC_AUTH_TOKEN: _anthropicToken,
    CLAUDE_CODE_OAUTH_TOKEN: _claudeToken, GEMINI_API_KEY: _gemini,
    GOOGLE_API_KEY: _google, ANTHROPIC_BASE_URL: _anthropicUrl,
    GOOGLE_GEMINI_BASE_URL: _geminiUrl, ANTIGRAVITY_PERM_GRANTS: _inheritedGrants, ...environment } = process.env
  if (connection.provider === "antigravity" && toolServer) {
    // Scope EdU's grants to this subprocess instead of changing the shared CLI settings.
    environment.ANTIGRAVITY_PERM_GRANTS = JSON.stringify({ allow: toolServer.names.map((name) => `mcp(edu/${name})`), deny: [], ask: [] })
  }
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("The provider request was canceled."))
      return
    }
    let commandArgs = args
    let stdin = input
    if (connection.provider === "antigravity" && args.includes("-p")) {
      // agy parses a bare -p followed by a flag as the prompt, rather than reading stdin.
      commandArgs = args.map((arg) => arg === "-p" ? `-p=${input}` : arg)
      stdin = ""
    }
    const child = spawn(connection.executable, commandArgs, {
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
    child.stdin.end(stdin)
  })
}

export function cliPromptArguments(connection: z.infer<typeof CliConnectionSchema>, schema: string, model = "default", effort?: string, webResearch = false, toolServer?: z.infer<typeof CliToolServerSchema>) {
  const args = ["-p", "--output-format", "json", "--json-schema", schema]
  if (connection.provider === "claude") {
    let nativeTools = ""
    if (webResearch) nativeTools = "WebSearch,WebFetch"
    let mcpConfig = { mcpServers: {} }
    let customizationMode = "--safe-mode"
    const allowedTools = []
    if (webResearch) allowedTools.push("WebSearch", "WebFetch")
    if (toolServer) {
      mcpConfig = { mcpServers: { edu: { type: "http", url: toolServer.url, headers: toolServer.headers } } }
      customizationMode = "--bare"
      allowedTools.push(...toolServer.names.map((name) => `mcp__edu__${name}`))
    }
    args.push("--tools", nativeTools, "--strict-mcp-config", "--mcp-config", JSON.stringify(mcpConfig), "--setting-sources", "", "--settings", '{"disableAllHooks":true}', customizationMode, "--no-session-persistence")
    if (allowedTools.length) args.push("--allowedTools", allowedTools.join(","))
  } else {
    let timeout = "2m"
    if (toolServer) timeout = "5m"
    args.push("--agent", "edu-tutor", "--sandbox", "--print-timeout", timeout)
  }
  args.push("--model", model === "default" ? providerDefaultModels[connection.provider] : model)
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
