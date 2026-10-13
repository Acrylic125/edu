import { Separator, type SeparatorProps } from "react-resizable-panels"

import { cn } from "../utils"

export function WorkspaceResizeHandle({ className, ...props }: SeparatorProps) {
  return (
    <Separator
      {...props}
      className={cn(
        "group flex w-3 items-center justify-center outline-none lg:w-4",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-8 w-1 rounded-full bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-ring group-data-[separator=active]:bg-primary motion-reduce:transition-none"
      />
    </Separator>
  )
}
