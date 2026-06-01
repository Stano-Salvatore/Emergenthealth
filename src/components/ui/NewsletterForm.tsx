"use client"

import { useState } from "react"

export function NewsletterForm() {
  const [email, setEmail] = useState("")
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle")

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState("loading")
    const res = await fetch("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
    setState(res.ok ? "done" : "error")
  }

  if (state === "done") {
    return (
      <p className="text-sm font-medium text-green-400">
        ✓ You&apos;re on the list! We&apos;ll keep you posted.
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none text-foreground bg-white/6"
        style={{ border: "1px solid color-mix(in srgb, var(--primary) 25%, transparent)" }}
      />
      <button
        type="submit"
        disabled={state === "loading"}
        className="px-5 py-2.5 rounded-xl text-sm font-medium bg-primary/70 text-primary-foreground transition-opacity hover:opacity-80 disabled:opacity-50 shrink-0"
      >
        {state === "loading" ? "…" : "Get updates"}
      </button>
      {state === "error" && (
        <p className="text-xs text-red-400 sm:col-span-2">Something went wrong. Try again.</p>
      )}
    </form>
  )
}
