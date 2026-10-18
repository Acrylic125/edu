import { WorkspaceSidebar } from "@edu/ui/workspace"
import appIcon from "./assets/app-icon.png"

function Skeleton({ className }: { className: string }) {
  return <div className={`rounded-full bg-border/60 ${className}`} />
}

export function WorkspaceLoading() {
  return (
    <div role="status" className="h-full overflow-auto">
      <span className="sr-only">Loading your workspace…</span>
      <div
        aria-hidden="true"
        className="mx-auto flex min-h-full w-full max-w-[850px] flex-col justify-center px-5 py-12 motion-safe:animate-pulse sm:px-8 lg:px-10"
      >
        <div className="mb-10 space-y-4">
          <Skeleton className="h-9 w-3/5 max-w-80 sm:h-11" />
          <Skeleton className="h-9 w-2/5 max-w-56 sm:h-11" />
          <div className="space-y-2.5 pt-3">
            <Skeleton className="h-3 w-4/5 max-w-96" />
            <Skeleton className="h-3 w-3/5 max-w-64" />
          </div>
        </div>
        <div className="rounded-3xl border border-border/70 p-5 sm:p-6">
          <Skeleton className="h-3 w-3/5 max-w-72" />
          <Skeleton className="mt-3 h-3 w-2/5 max-w-44" />
          <div className="mt-12 flex items-center gap-3">
            <Skeleton className="size-8 shrink-0" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="ml-auto size-9 shrink-0" />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>
    </div>
  )
}

export function WorkspaceLoadingSidebar() {
  return (
    <WorkspaceSidebar
      label="Workspace navigation"
      brand={
        <div className="flex items-center gap-3 text-xl font-semibold tracking-tight">
          <img src={appIcon} alt="" className="size-11 shrink-0 object-contain" />
          EdU
        </div>
      }
      footer={
        <div aria-hidden="true" className="ml-auto motion-safe:animate-pulse">
          <Skeleton className="size-8" />
        </div>
      }
    >
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <Skeleton className="mb-8 h-12 w-full" />
        <Skeleton className="mb-4 ml-3 h-2.5 w-16" />
        {["w-4/5", "w-3/5", "w-2/3", "w-1/2"].map((width) => (
          <div key={width} className="flex h-12 items-center gap-3 px-3">
            <Skeleton className="size-5 shrink-0 rounded-md" />
            <Skeleton className={`h-3 ${width}`} />
          </div>
        ))}
      </div>
    </WorkspaceSidebar>
  )
}
