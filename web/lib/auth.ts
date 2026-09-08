import { APIError, betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"

import db from "@/db/db"
import * as schema from "@/db/schema"
import { env } from "@/env"
import {
  isSchoolEmail,
  SCHOOL_EMAIL_ERROR_MESSAGE,
} from "@/lib/auth-email-whitelist"

export const auth = betterAuth({
  baseURL: env.NEXT_PUBLIC_BACKEND_URL,
    user: {
      additionalFields: {
        plan: { type: ["free", "pro"], defaultValue: "free", required: false, input: false },
      },
    },
  secret: env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: env.E2E_AUTH_ENABLED === "1",
    requireEmailVerification: false,
  },
  logger: {
    level: "debug",
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["microsoft"],
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (env.AUTH_EMAIL_WHITELIST_ENABLED === "1" && !isSchoolEmail(user.email)) {
            throw new APIError("FORBIDDEN", {
              code: "school_email_required",
              message: SCHOOL_EMAIL_ERROR_MESSAGE,
            })
          }
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          // Keep the school-only policy available while access is temporarily open.
          if (env.AUTH_EMAIL_WHITELIST_ENABLED !== "1") return

          const user = await context?.context.internalAdapter.findUserById(
            session.userId,
          )

          if (!user || !isSchoolEmail(user.email)) {
            throw new APIError("FORBIDDEN", {
              code: "school_email_required",
              message: SCHOOL_EMAIL_ERROR_MESSAGE,
            })
          }
        },
      },
    },
  },
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    microsoft: {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      tenantId: env.MICROSOFT_TENANT_ID,
      prompt: "select_account",
      // Entra profile photos are large base64 strings that can blow header limits.
      mapProfileToUser: () => ({
        emailVerified: true,
        image: undefined,
      }),
    },
  },
})
