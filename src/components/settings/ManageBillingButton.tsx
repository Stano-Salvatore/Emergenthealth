"use client"

import { useState } from "react"

export function ManageBillingButton() {
  const [loading, setLoading] = useState(false)

  async function openPortal() {
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" })
      const { url } = await res.json()
      if (url) window.location.href = url
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={openPortal}
      disabled={loading}
      className="shrink-0 rounded-lg border border-border text-muted-foreground text-xs font-medium px-3 py-1.5 hover:text-foreground hover:border-border/80 transition-colors disabled:opacity-50"
    >
      {loading ? "Loading…" : "Manage billing"}
    </button>
  )
}
