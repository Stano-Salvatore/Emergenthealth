"use client"

import { useSyncExternalStore } from "react"
import type { EmergyState } from "@/components/emergy/EmergySVG"

/**
 * One mood for one Emergy.
 *
 * His state is computed live on every request — it flips at 16:00 if there's no
 * water in yet, and it moves the moment you log anything (see api/emergy). Four
 * components used to fetch it independently on their own timers, so the mascot
 * in the nav could be grey and tired while the one in the chat header was pink
 * and wilting, on the same screen. He is one character; he gets one answer.
 *
 * Everyone reads this store, one request serves all of them, and a single timer
 * runs while anyone is mounted.
 */

export interface EmergyData {
  state: EmergyState
  message: string
  xp: number
  level: number
  levelName: string
  progress: number
  waterMl: number
  habitsDone: number
  totalHabits: number
}

const STALE_MS = 5 * 60 * 1000

let snapshot: EmergyData | null = null
let fetchedAt = 0
let inFlight: Promise<void> | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/**
 * Fetch his current state and tell everyone. Concurrent callers share the one
 * request rather than each firing their own.
 */
export function refreshEmergy(): Promise<void> {
  if (inFlight) return inFlight
  inFlight = fetch("/api/emergy")
    .then(r => (r.ok ? r.json() : null))
    .then((data: EmergyData | null) => {
      if (!data?.state) return
      snapshot = data
      fetchedAt = Date.now()
      emit()
    })
    .catch(() => {})
    .finally(() => { inFlight = null })
  return inFlight
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  if (!snapshot || Date.now() - fetchedAt > STALE_MS) void refreshEmergy()
  timer ??= setInterval(() => { void refreshEmergy() }, STALE_MS)

  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

// Identity only changes when a fetch lands, which is what useSyncExternalStore
// needs — returning a fresh object here would re-render forever.
function getSnapshot(): EmergyData | null {
  return snapshot
}

function getServerSnapshot(): EmergyData | null {
  return null
}

/** His full state, or null until the first fetch lands. */
export function useEmergy(): EmergyData | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Just his mood, for the avatars. Falls back to `okay` before the first fetch. */
export function useEmergyState(): EmergyState {
  return useEmergy()?.state ?? "okay"
}
