"use client"

import { useState, useEffect, useCallback } from "react"
import { MonitorSmartphone, LogOut } from "lucide-react"

interface SessionView {
  id: string
  signedInAt: string
  lastActiveAt: string
  expiresAt: string
  current: boolean
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })

// A session lasts 30 days. Without this card, ending one on a lost phone or a
// borrowed laptop meant deleting database rows by hand.
export function SessionsCard() {
  const [sessions, setSessions] = useState<SessionView[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() =>
    fetch("/api/account/sessions")
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then(body => setSessions(body.sessions))
      .catch(() => { setError("Couldn't load your sign-ins."); setSessions([]) }),
  [])

  useEffect(() => { load() }, [load])

  async function end(id?: string) {
    setBusy(id ?? "all")
    setError(null)
    const res = await fetch(`/api/account/sessions${id ? `?id=${encodeURIComponent(id)}` : ""}`, { method: "DELETE" })
      .catch(() => null)
    if (!res?.ok) {
      const body = await res?.json().catch(() => null)
      setError(body?.error ?? "Signing out didn't go through. Nothing changed — try again.")
    }
    setBusy(null)
    await load()
  }

  const others = sessions?.filter(s => !s.current) ?? []

  return (
    <div className="rounded-xl border bg-card px-4 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <MonitorSmartphone className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Where you&apos;re signed in</span>
      </div>

      {sessions === null ? (
        <div className="text-xs text-muted-foreground py-2">Loading…</div>
      ) : (
        <div className="divide-y divide-border/50">
          {sessions.map(s => (
            <div key={s.id} className="flex items-center justify-between py-2.5 gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.current ? "This device" : "Another device"}</p>
                <p className="text-xs text-muted-foreground">
                  Signed in {day(s.signedInAt)} · active {day(s.lastActiveAt)}
                </p>
              </div>
              {!s.current && (
                <button
                  onClick={() => end(s.id)}
                  disabled={!!busy}
                  className="text-xs text-muted-foreground hover:text-red-400 transition-colors px-2 py-1 shrink-0 disabled:opacity-50"
                >
                  {busy === s.id ? "…" : "Sign out"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {others.length > 1 && (
        <button
          onClick={() => end()}
          disabled={!!busy}
          className="flex items-center gap-1.5 rounded-lg bg-red-500/10 text-red-400 px-3 py-2 text-sm font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" />
          {busy === "all" ? "Signing out…" : `Sign out all ${others.length} other devices`}
        </button>
      )}
      {sessions !== null && others.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">Only this device is signed in.</p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
