import Link from "next/link"
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Circle,
  MessageSquareText,
} from "lucide-react"

export default function HomePage() {
  return (
    <main className="min-h-dvh overflow-hidden bg-background text-foreground [font-family:var(--font-geist-sans)]">
      <header className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-12">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md text-lg font-semibold tracking-[-0.02em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookOpenCheck className="size-4.5" aria-hidden="true" />
          </span>
          Edu
        </Link>
        <nav className="flex items-center gap-2" aria-label="Primary navigation">
          <Link
            href="/login"
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Log in
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Start learning
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid w-full max-w-7xl items-center gap-14 px-5 pt-16 pb-24 sm:px-8 sm:pt-24 lg:grid-cols-[0.88fr_1.12fr] lg:px-12 lg:pt-28 lg:pb-32">
        <div className="max-w-xl">
          <p className="mb-5 flex items-center gap-2 text-sm font-medium text-primary">
            <span className="h-px w-7 bg-current" aria-hidden="true" />
            A study space that keeps up
          </p>
          <h1 className="text-[clamp(3rem,7vw,5.8rem)] leading-[0.96] font-semibold tracking-[-0.065em] text-balance">
            Learn the hard parts properly.
          </h1>
          <p className="mt-7 max-w-lg text-lg leading-8 text-muted-foreground">
            Ask a question, build a clear learning plan, and work through it
            with explanations that adapt to what you already know.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Start a learning plan
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-border bg-card px-5 text-sm font-semibold text-card-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              See how it works
            </a>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-2xl lg:mx-0">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex h-12 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-2.5 text-sm font-semibold">
                <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <BookOpenCheck className="size-3.5" aria-hidden="true" />
                </span>
                Calculus foundations
              </div>
              <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                3 of 7 complete
              </span>
            </div>
            <div className="grid min-h-[420px] sm:grid-cols-[12.5rem_1fr]">
              <aside className="hidden border-r border-border bg-muted/40 p-4 sm:block">
                <p className="mb-4 text-xs font-medium text-muted-foreground">
                  Learning plan
                </p>
                <ol className="space-y-3 text-sm">
                  <li className="flex items-center gap-2 text-muted-foreground line-through">
                    <CheckCircle2 className="size-4 text-primary" /> Limits
                  </li>
                  <li className="flex items-center gap-2 font-medium text-primary">
                    <span className="flex size-4 items-center justify-center rounded-full border-2 border-current text-[9px]">2</span>
                    Derivatives
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Circle className="size-4" /> Chain rule
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Circle className="size-4" /> Applications
                  </li>
                </ol>
              </aside>
              <div className="flex flex-col p-5 sm:p-6">
                <div className="max-w-[88%] rounded-xl rounded-tl-sm bg-secondary p-4 text-sm leading-6 text-secondary-foreground">
                  A derivative tells you how quickly something changes at one
                  exact moment. Think of the speed shown on a car’s dashboard,
                  not the average speed for the whole trip.
                </div>
                <div className="mt-5 rounded-xl border border-border p-4">
                  <p className="text-xs font-medium text-muted-foreground">
                    Try this
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    If distance is s(t) = t², what does s′(3) describe?
                  </p>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-2/3 rounded-full bg-primary" />
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
                  <MessageSquareText className="size-4 text-primary" aria-hidden="true" />
                  Ask a follow-up question…
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="border-t border-border bg-card"
      >
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-20 sm:px-8 md:grid-cols-3 lg:px-12">
          {[
            ["01", "Name the goal", "Start with a topic, a syllabus, or the exact thing that is confusing you."],
            ["02", "Follow a clear plan", "Turn a broad subject into manageable steps and always know what comes next."],
            ["03", "Learn by asking", "Get an explanation, test your understanding, and ask as many follow-ups as you need."],
          ].map(([number, title, description]) => (
            <div key={number} className="border-l-2 border-secondary pl-5">
              <p className="text-sm font-semibold text-primary">{number}</p>
              <h2 className="mt-4 text-xl font-semibold tracking-[-0.025em]">{title}</h2>
              <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
