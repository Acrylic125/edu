"use client"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { signIn } from "@/lib/auth-client"

type LoginFormProps = {
  error?: string
}

export function LoginForm({ error }: LoginFormProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Use your Microsoft account.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {/* <Button
            type="button"
            onClick={() => {
              void signIn.social({
                provider: "google",
                callbackURL: "/",
              })
            }}
          >
            Continue with Google
          </Button> */}
          <Button
            type="button"
            onClick={() => {
              void signIn.social({
                provider: "microsoft",
                callbackURL: "/",
                errorCallbackURL: "/login",
              })
            }}
          >
            Continue with Microsoft
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
