"use client"

import { useState } from "react"
import { BookOpen, Check, LoaderCircle, MessageCircle } from "lucide-react"

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
        callbackURL: "/",
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
    <main className="flex min-h-dvh flex-col bg-background text-foreground [font-family:var(--font-geist-sans)] lg:flex-row">
      <section className="order-2 flex flex-col justify-between bg-secondary/35 px-6 py-10 sm:px-12 lg:order-1 lg:w-[56%] lg:px-16 lg:py-12 xl:px-24" aria-labelledby="learning-heading">
        <div className="hidden items-center gap-2.5 text-xl font-semibold tracking-tight lg:flex">
          <BookOpen className="size-6 text-primary" aria-hidden="true" /> Edu
        </div>
        <div className="mx-auto w-full max-w-lg py-4 lg:py-12">
          <h2 id="learning-heading" className="max-w-md text-4xl leading-[1.12] font-medium tracking-[-0.045em] sm:text-5xl xl:text-6xl">Make room for<br />your next aha.</h2>
          <p className="mt-5 max-w-sm text-base leading-7 text-muted-foreground">Bring your questions. Unpack the tricky parts. Build understanding, one conversation at a time.</p>
          <div className="mt-10 -rotate-2 rounded-xl border border-border bg-card p-6 shadow-lg sm:p-8" aria-label="Example learning conversation">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><MessageCircle className="size-4" aria-hidden="true" /> A little curiosity goes a long way</div>
            <p className="mt-6 text-lg font-medium tracking-tight">Why does a small change matter?</p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Think of a curve. Zoom in close enough, and it starts to look like a straight line.</p>
            <svg viewBox="0 0 360 110" className="mt-4 h-28 w-full text-primary" fill="none" aria-hidden="true">
              <path d="M15 95H345M30 100V10" stroke="currentColor" opacity=".2" />
              <path d="M40 86C130 85 185 70 220 48S280 14 330 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              <path d="m165 84 110-71" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 5" opacity=".6" />
              <circle cx="220" cy="48" r="6" fill="currentColor" />
            </svg>
            <div className="mt-3 flex items-center gap-2 text-sm font-medium text-[#42644b] dark:text-[#a7c9ae]"><Check className="size-4" aria-hidden="true" /> That’s the idea behind a derivative.</div>
          </div>
        </div>
        <p className="mt-8 text-sm text-muted-foreground">A space to ask, explore, and understand.</p>
      </section>
      <section className="order-1 flex flex-1 flex-col px-6 py-8 sm:px-12 lg:order-2 lg:px-16 lg:py-12" aria-labelledby="sign-in-heading">
        <div className="flex items-center gap-2 text-xl font-semibold lg:hidden"><BookOpen className="size-6 text-primary" aria-hidden="true" /> Edu</div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-16 lg:py-24">
          <div className="mb-7 flex size-12 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground"><BookOpen className="size-6" aria-hidden="true" /></div>
          <h1 id="sign-in-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">Your next chapter<br />starts here.</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">Sign in to your learning space.</p>
          <div className="mt-9 flex flex-col gap-3" aria-busy={pending !== null}>
            <Button type="button" variant="outline" className="h-13 w-full gap-3 bg-card text-sm motion-reduce:transition-none" disabled={pending !== null} onClick={() => void continueWith("google")}>
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.05v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.93a6 6 0 0 1 0-3.86V7.48H3.05a10 10 0 0 0 0 9.04l3.35-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.48l3.35 2.59A5.98 5.98 0 0 1 12 5.95Z"/></svg>
              Continue with Google
            </Button>
            <Button type="button" variant="outline" className="h-13 w-full gap-3 bg-card text-sm motion-reduce:transition-none" disabled={pending !== null} onClick={() => void continueWith("microsoft")}>
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
                  const result = await signUp.email({ email: `e2e-${crypto.randomUUID()}@e.ntu.edu.sg`, password: "E2e-Checkpoint-Password-2026!", name: "E2E Learner", callbackURL: "/" })
                  if (result.error) setSignInError("Test sign-in failed. Please try again.")
                } catch {
                  setSignInError("Unable to connect. Check your connection and try again.")
                } finally {
                  setPending(null)
                }
              }}>Continue as test user</Button>
            )}
          </div>
          <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">New here? Your account is created when you first sign in.</p>
        </div>
        <p className="text-center text-xs text-muted-foreground">Learn at your pace. Start with a question.</p>
      </section>
    </main>
  )
}
