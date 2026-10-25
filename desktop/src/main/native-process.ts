import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { promisify } from "node:util"
import { setTimeout } from "node:timers/promises"
import type { z } from "zod"
import type { WorkflowRecordSchema } from "../shared/tutor-workflow"

const inspect = promisify(execFile)

export async function nativeProcessIdentity(pid: number) {
  try {
    let executable = "ps"
    let args = ["-p", String(pid), "-o", "lstart=,comm="]
    if (process.platform === "win32") {
      executable = "powershell.exe"
      args = ["-NoProfile", "-NonInteractive", "-Command", `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object Id,StartTime,Path | ConvertTo-Json -Compress`]
    }
    const { stdout } = await inspect(executable, args, { timeout: 5000 })
    const identity = stdout.trim()
    if (!identity) return null
    return createHash("sha256").update(identity).digest("hex")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 1) return null
    throw new Error("The previous native process could not be inspected. Resolve its status before retrying.")
  }
}

export async function reconcileNativeProcesses(processes: z.infer<typeof WorkflowRecordSchema>["nativeProcesses"]) {
  for (const record of processes) {
    if (await nativeProcessIdentity(record.pid) !== record.identity) continue
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      try { process.kill(record.pid, signal) } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error
      }
      for (let attempt = 0; attempt < 20; attempt++) {
        if (await nativeProcessIdentity(record.pid) !== record.identity) break
        await setTimeout(25)
      }
      if (await nativeProcessIdentity(record.pid) !== record.identity) break
    }
    if (await nativeProcessIdentity(record.pid) === record.identity)
      throw new Error("The previous native attempt is still running. It cannot be repeated safely.")
  }
}
