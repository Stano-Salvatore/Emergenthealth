// Errors from inside the WebView, sent home.
//
// Server errors reach Vercel's runtime logs. A crash in the page on a tester's
// phone reaches nobody: no USB debugging, no console, just "it went blank".
// This posts what the browser knows — message, stack, page, build — to the
// feedback inbox, where the owner reads it beside the bug reports it usually
// explains.
//
// Deliberately quiet: a handful per page load, each distinct message once,
// and nothing for the stale-chunk case StaleChunkRecovery already handles by
// reloading. A reporter that floods is a reporter that gets switched off.

import { looksLikeStaleChunk } from "@/lib/stale-chunk"
import { installedBuild } from "@/lib/native/build"

const MAX_PER_PAGE = 5
const seen = new Set<string>()
let sent = 0

/** Browser noise with no bug behind it. */
export function ignorableClientError(message: string): boolean {
  if (!message.trim()) return true
  if (looksLikeStaleChunk(message)) return true
  // Chrome's benign layout warning, fired by every virtualised list.
  if (/ResizeObserver loop/.test(message)) return true
  // A navigation cancelling in-flight fetches — the user left, nothing broke.
  if (/^AbortError|The user aborted a request|Load failed$/.test(message)) return true
  // A tab closed mid-request or a phone that lost signal.
  if (/NetworkError when attempting to fetch|Failed to fetch$/.test(message)) return true
  return false
}

export interface ClientErrorReport {
  message: string
  stack?: string
  url: string
  build: number | null
  source: string
}

export function describeError(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: reason.message, stack: reason.stack }
  if (typeof reason === "string") return { message: reason }
  if (reason && typeof reason === "object" && "message" in reason) {
    return { message: String((reason as { message: unknown }).message) }
  }
  try { return { message: JSON.stringify(reason) } } catch { return { message: String(reason) } }
}

/** Post one error. Returns false when it was dropped as noise or over budget. */
export function reportClientError(reason: unknown, source: string): boolean {
  if (typeof window === "undefined") return false
  const { message, stack } = describeError(reason)
  if (ignorableClientError(message)) return false
  const key = message.slice(0, 200)
  if (seen.has(key) || sent >= MAX_PER_PAGE) return false
  seen.add(key)
  sent++

  const report: ClientErrorReport = {
    message: message.slice(0, 1000),
    stack: stack?.slice(0, 3000),
    url: window.location.pathname + window.location.search,
    build: installedBuild(),
    source,
  }
  // keepalive so a report from a page that is about to die still leaves.
  fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => {})
  return true
}
