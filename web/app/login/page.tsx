import { redirect } from "next/navigation"

import { LoginForm } from "@/app/login/login-form"
import { getSession } from "@/lib/auth-server"
import { SCHOOL_EMAIL_ERROR_MESSAGE } from "@/lib/auth-email-whitelist"
import { env } from "@/env"

type LoginPageProps = {
  searchParams: Promise<{
    error?: string
    error_description?: string
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getSession()
  if (session) {
    redirect("/")
  }

  const params = await searchParams
  let error: string | undefined

  if (params.error === "school_email_required") {
    error = SCHOOL_EMAIL_ERROR_MESSAGE
  } else if (params.error_description) {
    error = params.error_description
  } else if (params.error) {
    error = "Sign-in didn’t finish. Please try again or choose another account provider."
  }

  return <LoginForm error={error} e2eEnabled={env.NEXT_PUBLIC_E2E_AUTH_ENABLED === "1"} />
}
