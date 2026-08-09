"use client"

import { useState } from "react"
import { Eye, EyeOff, Copy, Check } from "lucide-react"

// A URL with an API key embedded in it. The key grants full read access to the
// account's health data, so it is masked until asked for — the key manager on
// the same page already masks keys, and printing the full token beside it made
// that pointless. Copy works without ever revealing it on screen.
export function SecretUrl({ url, secret, label }: { url: string; secret: string; label?: string }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  const masked = secret
    ? url.replace(secret, `${secret.slice(0, 4)}${"•".repeat(12)}${secret.slice(-4)}`)
    : url

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked — the reveal button is the fallback */ }
  }

  return (
    <div className="space-y-1.5">
      <div className={`rounded-lg bg-secondary/50 px-3 py-2 font-mono text-[11px] break-all ${revealed ? "select-all" : "select-none"}`}>
        {revealed ? url : masked}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setRevealed(r => !r)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {revealed ? <><EyeOff className="h-3 w-3" /> Hide</> : <><Eye className="h-3 w-3" /> Show</>}
        </button>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <><Check className="h-3 w-3 text-green-400" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
        </button>
        {label && <span className="text-[10px] text-muted-foreground/60">{label}</span>}
      </div>
    </div>
  )
}
