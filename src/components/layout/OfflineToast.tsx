"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { WifiOff, Wifi } from "lucide-react"

// Connectivity is a browser store, not component state: it has a current
// value, it emits when that value changes, and the server has no opinion. Read
// through useSyncExternalStore and the "is it offline right now" question
// answers itself on the first paint instead of one render later.
function subscribeToConnectivity(onChange: () => void): () => void {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

export function OfflineToast() {
  const isOffline = useSyncExternalStore(
    subscribeToConnectivity,
    () => !navigator.onLine,
    () => false,
  )
  // "Back online" is a moment, not a state — three seconds after the
  // connection returns, and nothing the browser can be asked about later. It
  // belongs to the event, so it is set from the event.
  const [showOnline, setShowOnline] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onOnline = () => {
      setShowOnline(true)
      clearTimeout(timer)
      timer = setTimeout(() => setShowOnline(false), 3000)
    }
    const onOffline = () => setShowOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    return () => {
      clearTimeout(timer)
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [])

  if (!isOffline && !showOnline) return null

  return (
    <div
      style={{ top: "calc(1rem + env(safe-area-inset-top))" }}
      className={`fixed left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg transition-all ${
        isOffline
          ? "bg-destructive/90 text-destructive-foreground"
          : "bg-green-500/90 text-white"
      }`}
    >
      {isOffline ? (
        <><WifiOff className="h-3.5 w-3.5 shrink-0" /> No internet connection</>
      ) : (
        <><Wifi className="h-3.5 w-3.5 shrink-0" /> Back online</>
      )}
    </div>
  )
}
