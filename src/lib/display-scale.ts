/**
 * Apply a display scale WITHOUT CSS `zoom`.
 *
 * CSS `zoom < 1` on a tall page makes Android's WebView exceed its composited
 * layer / texture-size limit, so everything past that point is painted black
 * even though the content is really there (scrollable but unpainted). That was
 * the "dead image / black half-screen" bug in Web layout mode.
 *
 * Instead we widen the layout viewport via the viewport <meta>, so the browser
 * scales the whole page down using NATIVE page scaling (tile-correct, no black).
 */
export function applyDisplayScale(zoom: number): void {
  if (typeof document === "undefined") return
  const scale = !zoom || Number.isNaN(zoom) ? 1 : zoom

  // Clear any legacy CSS zoom that an older build may have set.
  try {
    document.documentElement.style.zoom = ""
  } catch {
    /* */
  }

  let meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null
  if (!meta) {
    meta = document.createElement("meta")
    meta.setAttribute("name", "viewport")
    document.head.appendChild(meta)
  }

  if (scale > 0.999 && scale < 1.001) {
    meta.setAttribute("content", "width=device-width, initial-scale=1, viewport-fit=cover")
    return
  }

  // Widen the layout viewport so the page renders larger, then the browser
  // scales it to fit the screen. e.g. scale 0.5 → layout twice as wide.
  const base = (typeof window !== "undefined" && (window.screen?.width || window.innerWidth)) || 390
  const width = Math.round(base / scale)
  meta.setAttribute("content", `width=${width}, viewport-fit=cover`)
}
