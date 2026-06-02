"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export function CheckoutButton({ stripeReady, isSignedIn }: { stripeReady: boolean; isSignedIn: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleUpgrade() {
    if (!isSignedIn) {
      router.push("/signin")
      return
    }
    if (!stripeReady) return

    setLoading(true)
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" })
      const { url } = await res.json()
      if (url) window.location.href = url
    } finally {
      setLoading(false)
    }
  }

  if (!stripeReady) {
    return (
      <div className="w-full rounded-xl bg-primary/10 border border-primary/20 py-3 text-center text-sm text-primary/60">
        Coming soon — free during beta
      </div>
    )
  }

  return (
    <button
      onClick={handleUpgrade}
      disabled={loading}
      className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
    >
      {loading ? "Redirecting…" : isSignedIn ? "Start 14-day free trial →" : "Sign in to upgrade →"}
    </button>
  )
}
