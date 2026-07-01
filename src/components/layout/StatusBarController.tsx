"use client"

import { useEffect } from "react"

/* eslint-disable @typescript-eslint/no-explicit-any */

// Hides the Android system status bar (clock, signal, battery) on launch so
// the app feels full-screen. Native-only — dynamically imported so nothing
// loads or runs on the web build.
export function StatusBarController() {
  useEffect(() => {
    const cap = (window as any).Capacitor
    if (!cap?.isNativePlatform?.()) return
    import("@capacitor/status-bar")
      .then(({ StatusBar }) => StatusBar.hide())
      .catch(() => {})
  }, [])

  return null
}
