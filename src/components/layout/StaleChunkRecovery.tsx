"use client"

// Recover from a page whose code no longer exists on the server.
//
// The Android app keeps one long-lived WebView page, and the service worker
// serves the shell from cache, so a session can run a build that was deployed
// days ago. That mostly works — until the page reaches for a lazily-loaded
// chunk it hasn't cached. The chunk's URL belongs to the old build, the old
// build's assets are gone, and the import fails.
//
// The failure is invisible and looks like a missing feature: this is what made
// the notifications plugin "unavailable" on a phone whose app had the plugin
// installed and permission granted — the plugin's own module simply couldn't
// be fetched any more. Reloading picks up the current build and the feature
// reappears, so do that rather than leaving someone reading an explanation
// that doesn't apply to them.

import { useEffect } from "react"
import { looksLikeStaleChunk, reloadForFreshBuild } from "@/lib/stale-chunk"

export function StaleChunkRecovery() {
  useEffect(() => {
    function onError(e: ErrorEvent) {
      if (looksLikeStaleChunk(String(e.message ?? ""))) reloadForFreshBuild()
    }
    function onRejection(e: PromiseRejectionEvent) {
      const reason = e.reason
      const message = typeof reason === "string" ? reason : String(reason?.message ?? "")
      if (looksLikeStaleChunk(message)) reloadForFreshBuild()
    }
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)
    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }, [])

  return null
}
