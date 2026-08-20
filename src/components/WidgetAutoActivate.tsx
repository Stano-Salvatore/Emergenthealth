"use client"

import { useEffect } from "react"
import { ensureWidgetActivation, isCapacitorAndroid } from "@/lib/widget-activator"

// The home-screen widgets used to depend on a setup step buried in Settings —
// generate a key, then find "Activate Widget" — and everything else about them
// worked. Miss that step and all four widgets sit on the home screen saying
// "Set up in the app" with no clue what the app wants.
//
// This runs once per app start on the Android shell and quietly keeps the
// stored credentials in step with the account's key. Nothing is rendered.
export function WidgetAutoActivate() {
  useEffect(() => {
    if (!isCapacitorAndroid()) return
    let cancelled = false
    void (async () => {
      // Let the dashboard's own fetches go first; widget setup is not urgent.
      await new Promise(r => setTimeout(r, 4000))
      if (cancelled) return
      await ensureWidgetActivation()
    })()
    return () => { cancelled = true }
  }, [])

  return null
}
