import { env } from "@/env"
import { getSession } from "@/lib/auth-server"
import { UsagePayloadSchema } from "@/lib/usage/schema"

export async function loadUsage() {
  const session = await getSession()
  if (!session) {
    throw new Error("A session is required to load usage")
  }

  let response: Response

  try {
    response = await fetch(new URL("/usage", env.NEXT_PUBLIC_API_URL), {
      headers: { Authorization: `Bearer ${session.session.token}` },
      cache: "no-store",
    })
  } catch {
    throw new Error(
      `The usage API is unavailable at ${env.NEXT_PUBLIC_API_URL}. Start the API worker and try again.`,
    )
  }

  if (!response.ok) {
    throw new Error("Could not load usage")
  }

  return UsagePayloadSchema.parse(await response.json())
}
