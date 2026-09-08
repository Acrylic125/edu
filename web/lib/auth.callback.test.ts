import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

vi.mock("@/env", () => ({ env: {
  NEXT_PUBLIC_BACKEND_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "callback-test-only-9pX4mL8sQ2vR6kT1",
  GOOGLE_CLIENT_ID: "test-google-client", GOOGLE_CLIENT_SECRET: "test-google-secret",
  MICROSOFT_CLIENT_ID: "test-microsoft-client", MICROSOFT_CLIENT_SECRET: "test-microsoft-secret",
  MICROSOFT_TENANT_ID: "common", AUTH_EMAIL_WHITELIST_ENABLED: "0", E2E_AUTH_ENABLED: "0",
} }))
vi.mock("@/db/db", async () => {
  const { DatabaseSync } = await import("node:sqlite")
  const { drizzle } = await import("drizzle-orm/node-sqlite")
  const { readdirSync, readFileSync } = await import("node:fs")
  const schema = await import("../db/schema")
  const client = new DatabaseSync(":memory:")
  const root = new URL("../../backend/edu-api/migrations/", import.meta.url)
  for (const name of readdirSync(root).sort()) {
    client.exec(readFileSync(new URL(`${name}/migration.sql`, root), "utf8"))
  }
  return { default: drizzle({ client, schema }) }
})

import { auth } from "./auth"

async function completeGoogleCallback(email: string, subject: string) {
  const context = await auth.$context
  const google = context.socialProviders.find(
    (provider) => provider.id === "google",
  )
  if (!google) throw new Error("Missing Google provider")

  vi.spyOn(google, "validateAuthorizationCode").mockResolvedValue({
    accessToken: "fixture-token",
    scopes: ["email", "profile"],
  })
  vi.spyOn(google, "getUserInfo").mockResolvedValue({
    user: {
      name: "Fixture",
      email,
      emailVerified: true,
    },
    data: { sub: subject },
  })

  const start = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/login",
      }),
    }),
  )
  expect(start.status).toBe(200)
  const body = z.object({ url: z.string() }).parse(await start.json())
  const state = new URL(body.url).searchParams.get("state")
  const cookie = start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")

  return auth.handler(
    new Request(
      `http://localhost:3000/api/auth/callback/google?code=fixture&state=${state}`,
      { headers: { Cookie: cookie } },
    ),
  )
}

describe("Google OAuth callback", () => {
  it("creates a Free user and session through the real callback and database adapter", async () => {
    const response = await completeGoogleCallback(
      "fixture@example.invalid",
      "fixture-subject",
    )
    expect(
      response.headers.get("location"),
      "OAuth must not redirect to /login?error=...",
    ).toBe("/")
    expect(response.headers.getSetCookie().some((value) => value.startsWith("better-auth.session_token="))).toBe(true)
  })

  it("links Google to an existing verified same-email OAuth user", async () => {
    const context = await auth.$context
    const existing = await context.internalAdapter.createUser(
      {
        name: "Existing user",
        email: "existing@example.invalid",
        emailVerified: true,
        plan: "free",
      },
      { method: "oauth", oauth: { providerId: "microsoft" } },
    )
    await context.internalAdapter.createAccount({
      accountId: "existing-microsoft-subject",
      providerId: "microsoft",
      issuer: "https://login.microsoftonline.com/common/v2.0",
      userId: existing.id,
    })

    const response = await completeGoogleCallback(
      "existing@example.invalid",
      "existing-google-subject",
    )

    expect(
      response.headers.get("location"),
      "Verified Google email should link to the matching user",
    ).toBe("/")
    expect(
      response.headers
        .getSetCookie()
        .some((value) => value.startsWith("better-auth.session_token=")),
    ).toBe(true)
  })
})
