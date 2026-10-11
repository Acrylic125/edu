import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { afterEach, expect, test, vi } from "vitest"
import { shell } from "electron"
import { ModelAccount } from "../src/main/account"
import { z } from "zod"

vi.mock("electron", () => ({
  shell: { openExternal: vi.fn(async (_url: string) => {}) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) =>
      value.toString().replace(/^encrypted:/, ""),
  },
}))
const directories: string[] = []
const accounts: ModelAccount[] = []
const realFetch = globalThis.fetch
afterEach(async () => {
  accounts.splice(0).forEach((account) => account.cancel())
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "prune-account-"))
  directories.push(directory)
  const account = new ModelAccount(directory)
  accounts.push(account)
  return { account, directory }
}

test("PKCE callback rejects mismatched state, exchanges the code, and stores an encrypted key", async () => {
  const { account, directory } = await fixture()
  const exchange = vi.fn(
    async (_url: Parameters<typeof fetch>[0], _request?: RequestInit) =>
      Response.json({ key: "test-account-key" }),
  )
  vi.stubGlobal("fetch", exchange)
  const connection = account.connect()
  await vi.waitFor(() => expect(shell.openExternal).toHaveBeenCalledOnce())
  const auth = new URL(vi.mocked(shell.openExternal).mock.calls[0][0])
  const callback = new URL(auth.searchParams.get("callback_url")!)
  callback.searchParams.set("code", "test-code")
  callback.searchParams.set("state", "wrong")
  expect((await realFetch(callback)).status).toBe(400)
  expect(exchange).not.toHaveBeenCalled()
  callback.searchParams.set("state", auth.searchParams.get("state")!)
  expect((await realFetch(callback)).status).toBe(200)
  await connection
  expect(account.connected).toBe(true)
  expect(await account.key()).toBe("test-account-key")
  expect((await readFile(join(directory, "account.bin"))).toString()).toBe(
    "encrypted:test-account-key",
  )
  const request = vi.mocked(exchange).mock.calls[0]
  const body = z
    .object({
      code: z.string(),
      code_verifier: z.string(),
      code_challenge_method: z.string(),
    })
    .parse(JSON.parse(String(request[1]?.body)))
  expect(body.code).toBe("test-code")
  expect(body.code_challenge_method).toBe("S256")
  expect(auth.searchParams.get("code_challenge_method")).toBe("S256")
  expect(auth.searchParams.get("code_challenge")).toBe(
    createHash("sha256").update(body.code_verifier).digest("base64url"),
  )
  await account.disconnect()
  expect(account.connected).toBe(false)
  await expect(readFile(join(directory, "account.bin"))).rejects.toThrow()
})

test("cancels an in-flight connection and prevents overlapping browser sign-ins", async () => {
  const { account } = await fixture()
  const connection = account.connect()
  const rejected = expect(connection).rejects.toThrow("cancelled")
  await vi.waitFor(() => expect(shell.openExternal).toHaveBeenCalledOnce())
  await expect(account.connect()).rejects.toThrow("already open")
  account.cancel()
  await rejected
  expect(account.connected).toBe(false)
})
