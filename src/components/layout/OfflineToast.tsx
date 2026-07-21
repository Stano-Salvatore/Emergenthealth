"use client"

import { useEffect, useState } from "react"
import { WifiOff, Wifi } from "lucide-react"

export function OfflineToast() {
  const [isOffline, setIsOffline] = useState(false)
  const [showOnline, setShowOnline] = useState(false)

  useEffect(() => {
    function handleOffline() { setIsOffline(true); setShowOnline(false) }
    function handleOnline() {
      setIsOffline(false)
      setShowOnline(true)
      setTimeout(() => setShowOnline(false), 3000)
    }

    window.addEventListener("offline", handleOffline)
    window.addEventListener("online", handleOnline)
    setIsOffline(!navigator.onLine)

    return () => {
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("online", handleOnline)
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
