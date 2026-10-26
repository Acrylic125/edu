import { execFile } from "node:child_process"
import { access, constants, open, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, delimiter, dirname, isAbsolute, join } from "node:path"
import { promisify } from "node:util"
import { z } from "zod"

const execute = promisify(execFile)
const environment = z.object({
  PATH: z.string().default(""),
  APPDATA: z.string().optional(),
}).parse(process.env)

export async function resolveCodexExecutable(bundled: string, directories = [
  ...environment.PATH.split(delimiter).filter(isAbsolute),
  // Finder-launched apps do not inherit the user's shell PATH.
  join(homedir(), ".local", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  ...(environment.APPDATA ? [join(environment.APPDATA, "npm")] : []),
]) {
  const name = process.platform === "win32" ? "codex.exe" : "codex"
  for (const directory of new Set(directories)) {
    const executable = join(directory, name)
    try {
      if (!(await stat(executable)).isFile()) continue
      await access(executable, constants.X_OK)
      const target = await realpath(executable)
      const file = await open(target, "r")
      let launcher = false
      try {
        const header = Buffer.alloc(2)
        await file.read(header, 0, 2, 0)
        launcher = header.toString() === "#!" || /^(volta-shim|mise|aqua-proxy)(\.exe)?$/i.test(basename(target))
      } finally {
        await file.close()
      }
      // Native installs need the adjacent host; shell and Node launchers locate their own payloads.
      if (!launcher) {
        let host = "codex-code-mode-host"
        if (process.platform === "win32") host += ".exe"
        await access(join(dirname(target), host), constants.X_OK)
      }
      const options = { timeout: 5_000, maxBuffer: 256_000, windowsHide: true }
      const { stdout: version } = await execute(executable, ["--version"], options)
      const match = /^codex-cli (\d+)\.(\d+)\.(\d+)\s*$/.exec(version)
      if (!match) continue
      // Older releases lack the runtime and protocol features used by EdU's bundled 0.162.1.
      const [major, minor, patch] = match.slice(1).map(Number)
      if (major === 0 && (minor < 162 || (minor === 162 && patch < 1))) continue
      const { stdout: features } = await execute(executable, ["features", "list"], options)
      if (!/^code_mode_host\s/m.test(features) || !/^skip_host_skill_discovery\s/m.test(features)) continue
      await execute(executable, ["app-server", "--help"], options)
      // Keep the launcher path intact because version-manager shims dispatch by invoked name.
      return executable
    } catch {
      // Missing, unsupported, or broken local installations fall back to the bundled runtime.
    }
  }
  return bundled
}
