import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"

import db from "@/db/db"
import * as schema from "@/db/schema"
import { env } from "@/env"

export const auth = betterAuth({
  baseURL: env.NEXT_PUBLIC_BACKEND_URL,
  secret: env.BETTER_AUTH_SECRET,
  logger: {
    level: "debug",
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["microsoft"],
    },
  },
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  socialProviders: {
    // google: {
    //   clientId: env.GOOGLE_CLIENT_ID,
    //   clientSecret: env.GOOGLE_CLIENT_SECRET,
    // },
    microsoft: {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      tenantId: env.MICROSOFT_TENANT_ID,
      prompt: "select_account",
      // Entra profile photos are large base64 strings that can blow header limits.
      mapProfileToUser: () => ({ image: undefined }),
    },
  },
})
