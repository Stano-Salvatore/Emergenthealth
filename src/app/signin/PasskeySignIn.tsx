"use client"

import { useState, useEffect } from "react"
import { Fingerprint } from "lucide-react"
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser"
import { useRouter } from "next/navigation"

export function PasskeySignIn() {
  const [supported, setSupported] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    setSupported(browserSupportsWebAuthn())
  }, [])

  if (!supported) return null

  async function signInWithPasskey() {
    setLoading(true)
    setError(null)
    try {
      const optRes = await fetch("/api/passkey/authenticate")
      if (!optRes.ok) throw new Error("Failed to get options")
      const { tempToken, ...options } = await optRes.json()

      const response = await startAuthentication({ optionsJSON: options })

      const verifyRes = await fetch("/api/passkey/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, tempToken }),
      })

      if (!verifyRes.ok) {
        const { error } = await verifyRes.json()
        throw new Error(error ?? "Authentication failed")
      }

      router.push("/dashboard")
      router.refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes("cancelled") && !msg.includes("abort") && !msg.includes("NotAllowedError")) {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={signInWithPasskey}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2.5 h-11 rounded-xl bg-primary/15 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/25 transition-colors disabled:opacity-50"
      >
        <Fingerprint className="h-4 w-4" />
        {loading ? "Authenticating…" : "Sign in with passkey"}
      </button>
      {error && <p className="text-xs text-red-400 text-center mt-1.5">{error}</p>}
      <div className="flex items-center gap-3 my-3">
        <div className="flex-1 h-px bg-border/50" />
        <span className="text-xs text-muted-foreground/50">or</span>
        <div className="flex-1 h-px bg-border/50" />
      </div>
    </div>
  )
}
