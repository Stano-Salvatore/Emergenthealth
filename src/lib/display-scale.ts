/**
 * Display scaling ("Web mode" / Display Zoom), server-rendered via cookies.
 *
 * History of what didn't work, so nobody re-tries it:
 *  1. CSS `zoom < 1` on a tall page exceeds Android WebView's composited
 *     layer/texture-size limit — part of the screen is painted black even
 *     though the content is there (scrollable but unpainted).
 *  2. A wide `<meta name="viewport">` set/mutated via client JS after the
 *     initial parse DOES widen the layout viewport (CSS breakpoints see it —
 *     that's why a wider grid appeared), but WebView computes its
 *     zoom-to-fit ("initial-scale") ONCE from whatever viewport meta was in
 *     the raw HTML at first paint. A later DOM mutation can't retroactively
 *     change the scale it already locked in — so the page gets wider without
 *     ever visually shrinking to fit, which reads as "nothing happened."
 *
 * The fix: render the viewport <meta> SERVER-SIDE (see generateViewport() in
 * app/layout.tsx) from a cookie, so the very first bytes of HTML already have
 * the correct width + initial-scale — nothing needs to mutate it client-side.
 */

const ZOOM_COOKIE = "display_zoom"
const WIDTH_COOKIE = "device_width_css"
const YEAR = 60 * 60 * 24 * 365

function setCookie(name: string, value: string): void {
  if (typeof document === "undefined") return
  document.cookie = `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`
}

/** Persist the chosen zoom and reload so the server can render the correct
 * viewport meta from scratch (the only way that reliably takes effect on
 * Android WebView — see the module doc above). */
export function persistDisplayScale(zoom: number): void {
  const scale = !zoom || Number.isNaN(zoom) || zoom <= 0 ? 1 : zoom
  try {
    localStorage.setItem(ZOOM_COOKIE, String(scale))
  } catch {
    /* */
  }
  setCookie(ZOOM_COOKIE, String(scale))
  window.location.reload()
}

/** Captures the device's CSS-pixel width into a cookie so the server can
 * compute an accurate `width = deviceWidth / zoom` on the next render. Safe
 * to call on every mount; only writes when the value actually changed. */
export function captureDeviceWidth(): void {
  if (typeof window === "undefined") return
  const w = Math.round(window.screen?.width || window.innerWidth || 0)
  if (!w) return
  try {
    const existing = document.cookie
      .split("; ")
      .find(c => c.startsWith(`${WIDTH_COOKIE}=`))
      ?.split("=")[1]
    if (existing === String(w)) return
  } catch {
    /* */
  }
  setCookie(WIDTH_COOKIE, String(w))
}
