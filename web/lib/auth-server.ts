import { headers } from "next/headers"
import { cache } from "react"

import { auth } from "@/lib/auth"

export async function _getSession() {
  return auth.api.getSession({
    headers: await headers(),
  })
}

export const getSession = cache(_getSession)
