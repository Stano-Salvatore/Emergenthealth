"use client"

// Listens for what the page never caught and sends it home. Mounted once on
// the dashboard layout, beside StaleChunkRecovery — that one reloads on a
// missing chunk, this one reports everything else. See lib/client-error.ts.

import { useEffect } from "react"
import { reportClientError } from "@/lib/client-error"

export function ClientErrorReporter() {
  useEffect(() => {
    function onError(e: ErrorEvent) {
      reportClientError(e.error ?? e.message, "window.error")
    }
    function onRejection(e: PromiseRejectionEvent) {
      reportClientError(e.reason, "unhandledrejection")
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
