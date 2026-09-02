"use client"

import { signOutAndForget } from "@/lib/sign-out"
import { LogOut } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

// Signing out lived only in the side panel, which is not where people look for
// it — especially on a phone, where the panel is behind a hamburger.
export function SignOutCard({ email }: { email?: string | null }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Signed in</p>
          {email && <p className="text-xs text-muted-foreground mt-0.5 truncate">{email}</p>}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          onClick={() => signOutAndForget("/signin")}
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </Button>
      </CardContent>
    </Card>
  )
}
