export function MessageSkeletons() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-4 py-6">
      <div className="flex justify-end">
        <div className="h-10 w-2/5 max-w-xs animate-pulse rounded-2xl bg-secondary" />
      </div>
      <div className="flex justify-start">
        <div className="h-16 w-3/5 max-w-md animate-pulse rounded-2xl bg-muted" />
      </div>
      <div className="flex justify-end">
        <div className="h-8 w-1/3 max-w-xs animate-pulse rounded-2xl bg-secondary" />
      </div>
      <div className="flex justify-start">
        <div className="h-24 w-2/3 max-w-lg animate-pulse rounded-2xl bg-muted" />
      </div>
    </div>
  )
}
