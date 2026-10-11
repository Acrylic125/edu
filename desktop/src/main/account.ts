import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { safeStorage, shell } from "electron"
import { z } from "zod"

export class ModelAccount {
  private connecting = false
  private cancelConnection: (() => void) | undefined
  connected = false

  constructor(private directory: string) {}

  async load() {
    try {
      await this.key()
      this.connected = true
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return
      if (
        error instanceof Error &&
        error.message ===
          "Connect your model account in Runners to start learning."
      )
        return
      throw error
    }
  }

  async key() {
    const encrypted = await readFile(join(this.directory, "account.bin"))
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === "linux" &&
        safeStorage.getSelectedStorageBackend() === "basic_text")
    ) {
      throw new Error(
        "Secure credential storage is unavailable. Unlock your system keychain and reopen Prune.",
      )
    }
    const key = safeStorage.decryptString(encrypted)
    if (!key)
      throw new Error(
        "Connect your model account in Runners to start learning.",
      )
    return key
  }

  async connect() {
    if (this.connecting)
      throw new Error(
        "A sign-in window is already open. Finish that connection first.",
      )
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === "linux" &&
        safeStorage.getSelectedStorageBackend() === "basic_text")
    )
      throw new Error(
        "Unlock your system keychain before connecting an account.",
      )
    this.connecting = true
    const verifier = randomBytes(32).toString("base64url")
    const state = randomBytes(24).toString("hex")
    const path = `/callback/${randomBytes(16).toString("hex")}`
    const server = createServer()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", resolve)
      })
      const address = server.address()
      if (!address || typeof address === "string")
        throw new Error("Could not open a local sign-in callback.")
      const callback = `http://127.0.0.1:${address.port}${path}`
      const codePromise = new Promise<string>((resolve, reject) => {
        this.cancelConnection = () =>
          reject(new Error("Account connection cancelled."))
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "Sign-in timed out. Click Connect account to try again.",
              ),
            ),
          5 * 60_000,
        )
        server.on("request", (request, response) => {
          const url = new URL(request.url ?? "/", callback)
          if (
            request.method !== "GET" ||
            url.pathname !== path ||
            url.searchParams.get("state") !== state
          ) {
            response.writeHead(400).end("Invalid sign-in callback.")
            return
          }
          const code = url.searchParams.get("code")
          if (!code || code.length > 2048) {
            response.writeHead(400).end("Sign-in was not completed.")
            return
          }
          response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'",
          })
          response.end(
            "<html><title>Prune</title><body style='font:16px system-ui;padding:64px'><h1>Return to Prune</h1><p>Finishing your account connection. You can close this tab.</p></body></html>",
          )
          resolve(code)
        })
      })
      const url = new URL("https://openrouter.ai/auth")
      url.searchParams.set("callback_url", callback)
      url.searchParams.set(
        "code_challenge",
        createHash("sha256").update(verifier).digest("base64url"),
      )
      url.searchParams.set("code_challenge_method", "S256")
      url.searchParams.set("state", state)
      url.searchParams.set("key_label", "Prune desktop")
      // Attach both handlers before opening the browser so cancellation never creates an unhandled rejection.
      const [code] = await Promise.all([
        codePromise,
        shell.openExternal(url.toString()),
      ])
      const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          code,
          code_verifier: verifier,
          code_challenge_method: "S256",
        }),
      })
      if (!response.ok)
        throw new Error("Could not finish sign-in. Connect your account again.")
      const { key } = z
        .object({ key: z.string().min(1) })
        .parse(await response.json())
      await writeFile(
        join(this.directory, "account.bin"),
        safeStorage.encryptString(key),
        { mode: 0o600 },
      )
      this.connected = true
    } finally {
      clearTimeout(timeout)
      server.closeAllConnections()
      server.close()
      this.connecting = false
      this.cancelConnection = undefined
    }
  }

  cancel() {
    this.cancelConnection?.()
  }

  async disconnect() {
    this.cancel()
    await rm(join(this.directory, "account.bin"), { force: true })
    this.connected = false
  }
}
