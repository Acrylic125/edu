import { redirect } from "next/navigation"

import { LoginForm } from "@/app/login/login-form"
import { getSession } from "@/lib/auth-server"

export default async function LoginPage() {
  const session = await getSession()
  if (session) {
    redirect("/")
  }

  return <LoginForm />
}
