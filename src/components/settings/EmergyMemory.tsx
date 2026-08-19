"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { X } from "lucide-react"

// What Emergy remembers about the user, with the power to make it forget.
// Facts land here via the chat `remember` tool; deleting one removes it
// from every future conversation's context.

export function EmergyMemory() {
  const [facts, setFacts] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/emergy/memory")
      .then(r => r.json())
      .then(d => setFacts(Array.isArray(d.facts) ? d.facts : []))
      .catch(() => setFacts([]))
  }, [])

  async function forget(fact: string) {
    setBusy(fact)
    try {
      const res = await fetch("/api/emergy/memory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fact }),
      })
      const d = await res.json().catch(() => null)
      if (res.ok && d?.facts) setFacts(d.facts)
    } catch { /* leave the list as-is */ }
    setBusy(null)
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
          🌱 What Emergy remembers
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          Facts Emergy saved from your chats. It brings these into every conversation — remove anything wrong or stale.
        </p>
        {facts === null ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-8 bg-secondary rounded-lg animate-pulse" />
            ))}
          </div>
        ) : facts.length === 0 ? (
          <p className="text-sm text-muted-foreground/70">
            Nothing yet — when you tell Emergy something worth keeping (&quot;I&apos;m training for a marathon&quot;), it shows up here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {facts.map(fact => (
              <li
                key={fact}
                className="flex items-start justify-between gap-2 rounded-lg bg-secondary/60 px-3 py-2"
              >
                <span className="text-sm leading-snug min-w-0 break-words">{fact}</span>
                <button
                  onClick={() => forget(fact)}
                  disabled={busy === fact}
                  aria-label={`Forget "${fact}"`}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
