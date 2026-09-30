import Link from "next/link"

export default function ChatNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">Chat not found</h1>
      <p className="text-sm text-muted-foreground">This chat is unavailable or belongs to another account.</p>
      <Link href="/chat" className="rounded-md bg-secondary px-4 py-2 text-sm text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Start a new topic</Link>
    </div>
  )
}
