"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StickyNote, Check } from "lucide-react"

// A lightweight scratchpad widget. Notes persist to localStorage (device-local)
// and to the server preference so they follow you across devices. Debounced so
// typing doesn't hammer the network.
const STORAGE_KEY = "dashboard-notes-v1"

export function NotesWidget() {
  const [text, setText] = useState("")
  const [saved, setSaved] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Instant local paint, then hydrate from the server copy if present.
    try {
      const local = localStorage.getItem(STORAGE_KEY)
      if (local != null) setText(local)
    } catch { /* */ }
    fetch("/api/preferences/notes")
      .then(r => (r.ok ? r.json() : null))
      .then((d: { notes?: string | null } | null) => {
        if (d && typeof d.notes === "string") {
          setText(d.notes)
          try { localStorage.setItem(STORAGE_KEY, d.notes) } catch { /* */ }
        }
      })
      .catch(() => {})
  }, [])

  function onChange(v: string) {
    setText(v)
    setSaved(false)
    try { localStorage.setItem(STORAGE_KEY, v) } catch { /* */ }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      fetch("/api/preferences/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: v }),
      })
        .then(() => setSaved(true))
        .catch(() => {})
    }, 700)
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-1.5"><StickyNote className="h-4 w-4 text-amber-400" /> Notes</span>
          {saved && <Check className="h-3.5 w-3.5 text-green-400/70" aria-label="Saved" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <textarea
          value={text}
          onChange={e => onChange(e.target.value)}
          placeholder="Jot anything down…"
          className="w-full min-h-[120px] resize-none rounded-lg bg-secondary/40 border border-border/50 px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary/40 transition-colors"
        />
      </CardContent>
    </Card>
  )
}
