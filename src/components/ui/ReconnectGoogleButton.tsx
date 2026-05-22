"use client"

import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"

export function ReconnectGoogleButton({ label = "Reconnect Google", className }: { label?: string; className?: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      className={className}
      onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
    >
      {label}
    </Button>
  )
}
