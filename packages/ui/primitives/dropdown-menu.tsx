"use client"

import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "../utils"

export const DropdownMenu = MenuPrimitive.Root
export const DropdownMenuTrigger = MenuPrimitive.Trigger

export function DropdownMenuContent({ className, ...props }: MenuPrimitive.Popup.Props) {
  return <MenuPrimitive.Portal>
    <MenuPrimitive.Positioner className="z-50 outline-none" align="start" sideOffset={4}>
      <MenuPrimitive.Popup
        data-slot="dropdown-menu-content"
        className={cn("max-h-[min(20rem,var(--available-height))] min-w-48 overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none", className)}
        {...props}
      />
    </MenuPrimitive.Positioner>
  </MenuPrimitive.Portal>
}

export function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return <MenuPrimitive.Item
    data-slot="dropdown-menu-item"
    className={cn("flex cursor-default select-none items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0", className)}
    {...props}
  />
}
