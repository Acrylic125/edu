import { randomUUID } from "node:crypto"
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { TraceEventSchema, type Diagnostic } from "../shared/contracts"
import { z } from "zod"

export class TurnTrace {
  readonly id = randomUUID()
  readonly entries: z.infer<typeof TraceEventSchema>[] = []
  readonly path
  private writes = Promise.resolve()
  private error: Error | undefined
  private count = 0

  constructor(directory: string) {
    this.path = join(directory, `${this.id}.jsonl`)
    this.writes = mkdir(directory, { recursive: true, mode: 0o700 })
      .then(() => writeFile(this.path, "", { mode: 0o600 }))
      .catch((error: Error) => {
        this.error = error
      })
  }

  record: Diagnostic = (event, details) => {
    if (this.count++ >= 4000) return
    const redacted = Object.fromEntries(
      Object.entries(details).map(([key, value]) => {
        if (typeof value !== "string") return [key, value]
        return [
          key,
          value
            .replace(/Bearer\s+\S+/gi, "Bearer <REDACTED>")
            .replace(/\bsk-[A-Za-z0-9_-]+/g, "<REDACTED>")
            .replace(
              /([?&](?:token|code|api_key|access_token|refresh_token)=)[^&\s]+/gi,
              "$1<REDACTED>",
            )
            .slice(0, 3000),
        ]
      }),
    )
    const entry = TraceEventSchema.parse({
      time: new Date().toISOString(),
      event,
      details: redacted,
    })
    this.entries.push(entry)
    if (this.entries.length > 60) this.entries.shift()
    this.writes = this.writes
      .then(async () => {
        if (!this.error)
          await appendFile(this.path, JSON.stringify(entry) + "\n")
      })
      .catch((error: Error) => {
        this.error = error
      })
  }

  async flush() {
    await this.writes
    if (this.error)
      throw new Error(
        `Could not write the turn diagnostics: ${this.error.message}`,
      )
  }
}
