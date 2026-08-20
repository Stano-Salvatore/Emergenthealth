/* eslint-disable @typescript-eslint/no-explicit-any */
// Printing, which is not the one-liner it looks like.
//
// `window.print()` exists on an Android WebView's window object and does
// nothing whatsoever — no dialog, no error, no console warning. It is the same
// trap as `SpeechRecognition`, which is likewise present and likewise inert:
// the API surface is there, the service behind it is not. The health report's
// "Print / Save as PDF" button called window.print() directly, so on the phone
// — the only place the app is actually used — pressing it did nothing at all.
//
// MainActivity exposes an EhPrint bridge that hands the WebView to Android's
// PrintManager, whose dialog offers "Save as PDF" alongside real printers. On
// the web, window.print() is the right call and works.

function bridge(): any | null {
  if (typeof window === "undefined") return null
  return (window as any).EhPrint ?? null
}

/**
 * Can this surface actually print?
 *
 * "native" — the print bridge is here; PrintManager will open.
 * "web"    — an ordinary browser; window.print() works.
 * "none"   — the Android shell without the bridge (an APK older than the
 *            bridge). Printing is impossible and the UI must say so rather
 *            than offer a button that silently fails.
 */
export function printSupport(): "native" | "web" | "none" {
  if (typeof window === "undefined") return "none"
  if (bridge()) return "native"
  const cap = (window as any).Capacitor
  if (cap?.isNativePlatform?.()) return "none"
  return "web"
}

/**
 * Open the print dialog. Returns false when the surface can't print at all,
 * so the caller can offer the fallback instead of pretending it worked.
 */
export function printPage(documentName: string): boolean {
  const b = bridge()
  if (b) {
    try {
      b.print(documentName)
      return true
    } catch {
      return false
    }
  }
  if (printSupport() !== "web") return false
  try {
    window.print()
    return true
  } catch {
    return false
  }
}
