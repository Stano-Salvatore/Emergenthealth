"use client"

import { useCallback, useEffect, useState } from "react"
import { Sparkles, Check, X, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

// Frequent places mined from stored GPS points, offered as one-tap saved
// places. Saving one is what switches on the automatic logging: the existing
// place machinery auto-creates check-ins whenever a live position or a viewed
// day's track lands inside a saved place's radius.
//
// Dismissals live in localStorage — a rejected suggestion is an opinion about
// this phone's owner, not server state worth a schema.

interface Candidate {
  lat: number
  lng: number
  days: number
  points: number
  firstSeen: string
  lastSeen: string
  name: string
  address: string | null
}

const DISMISSED_KEY = "suggested_places_dismissed"

function keyOf(c: { lat: number; lng: number }): string {
  return `${c.lat.toFixed(4)}_${c.lng.toFixed(4)}`
}

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

export function SuggestedPlaces({ refreshKey = 0, onSaved }: { refreshKey?: number; onSaved?: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/location/frequent-places${force ? "?force=1" : ""}`)
      if (!res.ok) { setCandidates([]); return }
      const data = await res.json() as { candidates?: Candidate[] }
      const dismissed = readDismissed()
      setCandidates((data.candidates ?? []).filter(c => !dismissed.has(keyOf(c))))
    } catch {
      setCandidates([])
    } finally {
      setLoading(false)
    }
  }, [])

  // refreshKey bumps after a timeline import — new history deserves a fresh
  // mining pass rather than yesterday's cache.
  useEffect(() => { load(refreshKey > 0) }, [refreshKey, load])

  function dismiss(c: Candidate) {
    try {
      const d = readDismissed()
      d.add(keyOf(c))
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...d]))
    } catch { /* ignore */ }
    setCandidates(list => list.filter(x => keyOf(x) !== keyOf(c)))
  }

  async function save(c: Candidate): Promise<boolean> {
    setSavingKey(keyOf(c))
    try {
      const res = await fetch("/api/saved-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: c.name,
          emoji: "📍",
          address: c.address,
          lat: c.lat,
          lng: c.lng,
          radiusM: 150,
        }),
      })
      if (!res.ok) return false
      setSavedKeys(s => new Set(s).add(keyOf(c)))
      setTimeout(() => setCandidates(list => list.filter(x => keyOf(x) !== keyOf(c))), 1200)
      onSaved?.()
      return true
    } catch {
      return false
    } finally {
      setSavingKey(null)
    }
  }

  async function saveAll() {
    for (const c of candidates) {
      if (!savedKeys.has(keyOf(c))) await save(c)
    }
  }

  if (loading || candidates.length === 0) return null

  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" /> Places you keep being at
        </p>
        {candidates.length > 1 && (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={savingKey !== null} onClick={saveAll}>
            Save all {candidates.length}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Saving a place turns on automatic check-ins whenever you&apos;re there.
      </p>
      <ul className="space-y-2">
        {candidates.map(c => {
          const k = keyOf(c)
          const isSaved = savedKeys.has(k)
          return (
            <li key={k} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">📍 {c.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Seen {c.days} days · last {c.lastSeen}{c.address ? ` · ${c.address}` : ""}
                </p>
              </div>
              {isSaved ? (
                <span className="text-xs text-green-400 flex items-center gap-1 shrink-0">
                  <Check className="h-3.5 w-3.5" /> Saved
                </span>
              ) : (
                <>
                  <Button
                    size="sm" variant="outline" className="h-7 text-xs shrink-0"
                    disabled={savingKey !== null}
                    onClick={() => save(c)}
                  >
                    {savingKey === k ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Save"}
                  </Button>
                  <button
                    onClick={() => dismiss(c)}
                    aria-label="Dismiss suggestion"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
