import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
    CLOUDFLARE_DATABASE_ID: z.string().min(1),
    CLOUDFLARE_TOKEN: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    MICROSOFT_CLIENT_ID: z.string().min(1),
    MICROSOFT_CLIENT_SECRET: z.string().min(1),
    MICROSOFT_TENANT_ID: z.string().min(1),
    AUTH_EMAIL_WHITELIST_ENABLED: z.enum(["0", "1"]).default("0"),
    E2E_AUTH_ENABLED: z.enum(["0", "1"]).default("0"),
    AUTH_D1_STATE_DIR: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_BACKEND_URL: z.url(),
    NEXT_PUBLIC_API_URL: z.url(),
    NEXT_PUBLIC_E2E_AUTH_ENABLED: z.enum(["0", "1"]).default("0"),
  },
  runtimeEnv: {
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_DATABASE_ID: process.env.CLOUDFLARE_DATABASE_ID,
    CLOUDFLARE_TOKEN: process.env.CLOUDFLARE_TOKEN,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_E2E_AUTH_ENABLED: process.env.NEXT_PUBLIC_E2E_AUTH_ENABLED,
    AUTH_EMAIL_WHITELIST_ENABLED: process.env.AUTH_EMAIL_WHITELIST_ENABLED,
    E2E_AUTH_ENABLED: process.env.E2E_AUTH_ENABLED,
    AUTH_D1_STATE_DIR: process.env.AUTH_D1_STATE_DIR,
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  emptyStringAsUndefined: true,
})
