'use client'

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"

export function CredentialsSignInForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    const username = usernameRef.current?.value ?? ""
    const password = passwordRef.current?.value ?? ""
    try {
      const res = await fetch("/api/credentials-signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })
      if (res.ok) {
        // 200: HTML body with window.location.replace('/dashboard')
        // The Set-Cookie header is processed by the browser automatically.
        // Execute the body so the JS redirect fires.
        const html = await res.text()
        document.open()
        document.write(html)
        document.close()
      } else {
        // 401/404: JSON error from the server
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? "Invalid username or password.")
        setLoading(false)
      }
    } catch {
      setError("Connection error. Please try again.")
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        <input
          ref={usernameRef}
          name="username"
          type="text"
          autoComplete="username"
          placeholder="Username"
          required
          className="w-full h-11 px-4 rounded-xl bg-white/5 border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <input
          ref={passwordRef}
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          required
          className="w-full h-11 px-4 rounded-xl bg-white/5 border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      {error && (
        <p className="text-xs text-red-400 text-center">{error}</p>
      )}
      <Button
        type="submit"
        disabled={loading}
        className="w-full h-11 text-sm font-semibold rounded-xl"
        size="lg"
      >
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  )
}
