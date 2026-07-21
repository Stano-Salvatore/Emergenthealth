"use client"

import { useEffect } from "react"

/* eslint-disable @typescript-eslint/no-explicit-any */

// Keeps the app's content from colliding with the Android system status bar
// (clock, signal, battery, notifications). Native-only — the status-bar plugin
// is dynamically imported so nothing loads or runs on the web build.
//
// We deliberately do NOT hide the status bar. On modern Android (targetSdk 35+)
// edge-to-edge is forced by the system and StatusBar.hide() is unreliable — the
// bar reappears and overlaps the UI (the sidebar was rendering underneath the
// clock/wifi icons). Instead we:
//   1. Ask the system to lay the WebView out BELOW the bar (overlay: false).
//   2. Colour the bar to match the app so it blends in.
//   3. Pick light/dark icons based on the active theme.
// A matching set of `env(safe-area-inset-top)` paddings in the layout handles
// the case where the OS forces edge-to-edge anyway (then the inset is non-zero
// and content is padded down; when overlay:false is honoured the inset is 0 and
// nothing is double-spaced).
export function StatusBarController() {
  useEffect(() => {
    const cap = (window as any).Capacitor
    if (!cap?.isNativePlatform?.()) return

    const isLight =
      document.documentElement.classList.contains("light") ||
      document.documentElement.getAttribute("data-theme") === "light"

    // Match the app background so the bar is seamless. Keep in sync with the
    // --background values in globals.css.
    const barColor = isLight ? "#f5f5fb" : "#09090f"

    import("@capacitor/status-bar")
      .then(({ StatusBar, Style }) => {
        // Reserve space for the bar instead of drawing under it.
        StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {})
        // Style.Light = dark icons (for a light bar); Style.Dark = light icons.
        StatusBar.setStyle({ style: isLight ? Style.Light : Style.Dark }).catch(() => {})
        StatusBar.setBackgroundColor({ color: barColor }).catch(() => {})
        StatusBar.show().catch(() => {})
      })
      .catch(() => {})
  }, [])

  return null
}
