"use client"

import { useState, useSyncExternalStore } from "react"

// Reading something only the browser knows — a localStorage entry, a media
// query, whether a native bridge is present — without the setState-in-an-effect
// dance that renders once with a placeholder and then immediately again.
//
// The effect version is not just noisy: it paints the wrong value first. This
// renders the server's answer on the server and the real one from the client's
// very first paint.
//
// Primitives only. useSyncExternalStore compares snapshots with Object.is and
// re-renders forever if `read` returns a fresh object each call, so anything
// that builds an array or an object needs its own memoised store instead.

const noopSubscribe = () => () => {}

export function useClientValue<T extends string | number | boolean | null | undefined>(
  read: () => T,
  serverValue: T,
): T {
  return useSyncExternalStore(noopSubscribe, read, () => serverValue)
}

/** localStorage, minus the "window is not defined" and private-mode throws. */
export function readLocalString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

/**
 * A setting that starts life in the browser (localStorage, a media query) and
 * can then be changed on screen.
 *
 * The stored value is read without an effect, so the first paint is already
 * correct; the local override takes over the moment the user changes it. Note
 * `??`, not `||` — false and 0 are legitimate values, not "unset".
 */
export function useLocalSetting<T extends string | number | boolean>(
  read: () => T,
  serverValue: T,
): [T, (value: T) => void] {
  const stored = useClientValue(read, serverValue)
  const [override, setOverride] = useState<T | null>(null)
  return [override ?? stored, setOverride as (value: T) => void]
}
