import Link from "next/link"
import {
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  Check,
  CheckCircle2,
  FileText,
  MessageCircle,
  Sparkles,
} from "lucide-react"

import { LearningBooks } from "@/components/learning/learning-books"
import { ThemeMenu } from "@/components/theme/theme-menu"

export default function HomePage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex h-24 w-full max-w-7xl items-center justify-between gap-3 px-5 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-3 rounded-xl text-xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-learning-yellow text-primary"><BookOpenCheck className="size-5" aria-hidden="true" /></span>
          Edu
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4" aria-label="Primary navigation">
          <ThemeMenu />
          <Link href="/login" className="rounded-full px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Log in</Link>
          <Link href="/login" className="hidden h-11 items-center gap-3 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:inline-flex">Start learning<ArrowRight className="size-4" aria-hidden="true" /></Link>
        </nav>
      </header>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-5 pb-6 pt-4 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:px-12 lg:pt-8">
        <div className="relative flex flex-col overflow-hidden rounded-[2.5rem] bg-learning-yellow px-7 pb-8 pt-10 text-learning-ink sm:px-10 sm:pt-12 lg:min-h-[620px]">
          <div className="flex items-center gap-2 text-sm text-learning-subtle"><BookOpen className="size-4" aria-hidden="true" /> A space for your next chapter</div>
          <h1 className="relative z-10 mt-7 max-w-md text-[clamp(2.75rem,5vw,4.4rem)] font-semibold leading-[1.06] tracking-[-0.055em] text-balance">Learn the hard parts properly.</h1>
          <LearningBooks className="mx-auto -mb-3 mt-1 w-full max-w-[360px] lg:-mb-8 lg:-mt-1" />
          <div className="relative z-10 mt-auto flex items-center justify-between gap-4 rounded-[1.75rem] bg-card p-5 text-card-foreground sm:p-6">
            <div><p className="text-lg font-semibold tracking-tight">Start learning today</p><p className="mt-1 text-sm text-muted-foreground">One question is all it takes.</p></div>
            <Link href="/login" aria-label="Start a learning plan" className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><ArrowRight className="size-6" aria-hidden="true" /></Link>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="rounded-[2.5rem] bg-card px-7 py-8 sm:p-10">
            <div className="mb-7 flex items-center justify-between"><span className="flex size-12 items-center justify-center rounded-full bg-learning-yellow text-primary"><Sparkles className="size-5" aria-hidden="true" /></span><span className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">Your learning workspace</span></div>
            <h2 className="max-w-md text-3xl font-semibold leading-[1.15] tracking-[-0.04em] sm:text-4xl">Big topics.<br />Small, clear steps.</h2>
            <p className="mt-4 max-w-md text-base leading-7 text-muted-foreground">Bring your questions, slides, or past year papers. Build a learning plan and work through it with explanations that meet you where you are.</p>
            <Link href="/login" className="mt-7 inline-flex items-center gap-3 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Build your learning plan<ArrowRight className="size-4" aria-hidden="true" /></Link>
          </div>

          <div className="relative flex-1 overflow-hidden rounded-[2.5rem] bg-learning-sage p-7 text-learning-ink sm:px-9 sm:py-8" aria-label="Example learning plan">
            <BookOpen className="pointer-events-none absolute -bottom-7 -right-6 size-48 -rotate-12 text-learning-circle" strokeWidth={1} aria-hidden="true" />
            <div className="relative flex items-center justify-between gap-3"><span className="flex size-11 items-center justify-center rounded-full bg-learning-circle"><BookOpen className="size-5" aria-hidden="true" /></span><span className="flex items-center gap-1.5 rounded-full bg-learning-circle px-3 py-1.5 text-xs font-medium"><CheckCircle2 className="size-3.5" aria-hidden="true" /> Example plan</span></div>
            <p className="relative mt-5 text-sm text-learning-subtle">Mathematics</p>
            <h3 className="relative mt-1.5 text-2xl font-semibold tracking-tight">Making sense of calculus</h3>
            <ol className="relative mt-5 flex flex-wrap gap-2 text-xs font-medium">
              <li className="flex items-center gap-1.5 rounded-full bg-learning-circle px-3 py-2"><Check className="size-3.5" aria-hidden="true" /> Limits</li>
              <li className="rounded-full bg-learning-ink px-3 py-2 text-learning-sage">Derivatives</li>
              <li className="rounded-full border border-learning-ink/15 px-3 py-2">Integrals</li>
            </ol>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto w-full max-w-7xl px-5 pb-16 pt-8 sm:px-8 lg:px-12 lg:pt-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Make room for understanding.</h2><p className="text-sm text-muted-foreground">A little structure goes a long way.</p></div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { title: "Bring your materials", description: "Start with a topic, your slides, or the question that has you stuck.", icon: FileText, color: "bg-learning-yellow" },
            { title: "Find your path", description: "Break a difficult subject into manageable steps you can follow.", icon: BookOpenCheck, color: "bg-learning-sage" },
            { title: "Keep asking", description: "Try an explanation, test your understanding, and ask a follow-up.", icon: MessageCircle, color: "bg-learning-blue" },
          ].map((item) => (
            <div key={item.title} className={`flex gap-4 rounded-[1.75rem] p-6 text-learning-ink ${item.color}`}>
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-learning-circle"><item.icon className="size-5" aria-hidden="true" /></span>
              <div><h3 className="text-base font-semibold tracking-tight">{item.title}</h3><p className="mt-2 max-w-xs text-sm leading-6 text-learning-subtle">{item.description}</p></div>
            </div>
          ))}
        </div>
      </section>
      <footer className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 pb-8 text-xs text-muted-foreground sm:px-8 lg:px-12"><span>Edu</span><span>For the joy of figuring it out.</span></footer>
    </main>
  )
}
