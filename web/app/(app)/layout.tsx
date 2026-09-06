import type { ReactNode } from "react"
import { redirect } from "next/navigation"

import { getSession } from "@/lib/auth-server"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session) {
    redirect("/login")
  }

  return children
}
