"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleUserRound, LogOut, Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { signOut, useSession } from "@/lib/auth-client"

export function AccountMenu() {
  const router = useRouter()
  const session = useSession()
  const user = session.data?.user

  let label = "Account"
  if (user?.name) {
    label = user.name
  } else if (user?.email) {
    label = user.email
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        render={<Button variant="ghost" size="icon-sm" />}
      >
        <CircleUserRound />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <div className="px-1.5 py-1">
          <p className="truncate text-sm text-foreground">{label}</p>
          {user?.email && user.name ? (
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<Link href="/settings" />}
          className="cursor-pointer"
        >
          <Settings />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          className="cursor-pointer"
          onClick={() => {
            void signOut().then(() => {
              router.push("/login")
              router.refresh()
            })
          }}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
