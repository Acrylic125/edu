"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, BookOpenCheck, Check, LoaderCircle } from "lucide-react"

import { LearningBooks } from "@/components/learning/learning-books"
import { ThemeMenu } from "@/components/theme/theme-menu"
import { Button } from "@/components/ui/button"
import { signIn, signUp } from "@/lib/auth-client"

type LoginFormProps = {
  error?: string
  e2eEnabled?: boolean
}

export function LoginForm({ error, e2eEnabled = false }: LoginFormProps) {
  const [pending, setPending] = useState<"google" | "microsoft" | "test" | null>(null)
  const [signInError, setSignInError] = useState(error)

  async function continueWith(provider: "google" | "microsoft") {
    setPending(provider)
    setSignInError(undefined)
    try {
      const result = await signIn.social({
        provider,
        callbackURL: "/chat",
        errorCallbackURL: "/login",
      })
      if (result.error) {
        setSignInError("We couldn’t start sign-in. Please try again or choose another account provider.")
        setPending(null)
      }
    } catch {
      setSignInError("Unable to connect. Check your connection and try again.")
      setPending(null)
    }
  }

  return (
    <main className="grid min-h-dvh gap-4 bg-background p-3 text-foreground sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(28rem,1fr)]">
      <section className="relative hidden overflow-hidden rounded-[2.5rem] bg-learning-yellow p-10 text-learning-ink lg:flex lg:flex-col xl:p-12" aria-labelledby="learning-heading">
        <Link href="/" className="relative flex w-fit items-center gap-2.5 rounded-md text-lg font-semibold tracking-[-0.02em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-learning-circle text-primary">
            <BookOpenCheck className="size-4.5" aria-hidden="true" />
          </span>
          Edu
        </Link>

        <div className="relative my-auto max-w-xl py-8">
          <h2 id="learning-heading" className="text-4xl font-semibold leading-[1.08] tracking-[-0.045em] xl:text-5xl">
            Pick up exactly where you left off.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-learning-subtle">
            Your plans, questions, and progress stay together, so every session can build on the last one.
          </p>
          <LearningBooks className="mx-auto mt-2 w-full max-w-[340px]" />
          <ul className="space-y-3 rounded-[1.75rem] bg-learning-circle p-6 text-sm font-medium">
            <li className="flex items-center gap-3"><Check className="size-4 text-primary" aria-hidden="true" /> Structured plans for difficult topics</li>
            <li className="flex items-center gap-3"><Check className="size-4 text-primary" aria-hidden="true" /> Explanations that follow your questions</li>
            <li className="flex items-center gap-3"><Check className="size-4 text-primary" aria-hidden="true" /> Progress saved between sessions</li>
          </ul>
        </div>

        <p className="relative text-xs text-learning-subtle">Built for focused, self-directed learning.</p>
      </section>

      <section className="flex min-h-[calc(100dvh-1.5rem)] flex-col rounded-[2.5rem] bg-card px-5 py-6 sm:min-h-[calc(100dvh-2.5rem)] sm:px-10 sm:py-8 lg:px-12 xl:px-16" aria-labelledby="sign-in-heading">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 text-base font-semibold lg:hidden">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-learning-circle text-primary"><BookOpenCheck className="size-4.5" aria-hidden="true" /></span>
            Edu
          </Link>
          <div className="ml-auto flex items-center gap-3"><ThemeMenu />
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <ArrowLeft className="size-4" aria-hidden="true" /> Home
          </Link></div>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-14">
          <h1 id="sign-in-heading" className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Log in to Edu</h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">Use your school account to continue.</p>
          <div className="mt-8 flex flex-col gap-3" aria-busy={pending !== null}>
            <Button type="button" variant="outline" className="h-14 w-full gap-3 rounded-full border-border bg-background text-sm shadow-none motion-reduce:transition-none" disabled={pending !== null} onClick={() => void continueWith("google")}>
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.05v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.93a6 6 0 0 1 0-3.86V7.48H3.05a10 10 0 0 0 0 9.04l3.35-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.48l3.35 2.59A5.98 5.98 0 0 1 12 5.95Z"/></svg>
              Continue with Google
            </Button>
            <Button type="button" variant="outline" className="h-14 w-full gap-3 rounded-full border-border bg-background text-sm shadow-none motion-reduce:transition-none" disabled={pending !== null} onClick={() => void continueWith("microsoft")}>
              <svg viewBox="0 0 21 21" className="size-5" aria-hidden="true"><path fill="#f25022" d="M0 0h10v10H0z"/><path fill="#7fba00" d="M11 0h10v10H11z"/><path fill="#00a4ef" d="M0 11h10v10H0z"/><path fill="#ffb900" d="M11 11h10v10H11z"/></svg>
              Continue with Microsoft
            </Button>
            {pending && <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Connecting to your account…</p>}
            {signInError && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{signInError}</p>}
            {e2eEnabled && (
              <Button type="button" variant="outline" className="h-12" disabled={pending !== null} onClick={async () => {
                setPending("test")
                setSignInError(undefined)
                try {
                  const result = await signUp.email({ email: `e2e-${crypto.randomUUID()}@e.ntu.edu.sg`, password: "E2e-Checkpoint-Password-2026!", name: "E2E Learner", callbackURL: "/chat" })
                  if (result.error) setSignInError("Test sign-in failed. Please try again.")
                } catch {
                  setSignInError("Unable to connect. Check your connection and try again.")
                } finally {
                  setPending(null)
                }
              }}>Continue as test user</Button>
            )}
          </div>
          <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">Your account is created automatically the first time you log in.</p>
        </div>
        <p className="text-center text-xs text-muted-foreground">Only approved school email addresses can access Edu.</p>
      </section>
    </main>
  )
}
