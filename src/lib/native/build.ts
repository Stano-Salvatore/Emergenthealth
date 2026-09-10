// Which APK this page is running inside.
//
// The shell loads its code from the server, so the web layer cannot ask the
// bundle which version it is — the bundle is always the latest deploy. The
// APK's own build number is stamped into the WebView's user agent at build
// time (capacitor.config.ts), and this reads it back. Nothing else in the app
// knows it: there is no version plugin, and adding one would need the very
// APK update this exists to prompt for.

import { isNativeShell } from "./shell"

/** The UA token carrying the versionCode: `EmergenthealthBuild/1062`. */
export const BUILD_UA_TOKEN = "EmergenthealthBuild/"

/** Parse the build number out of a user agent, or null when it carries none. */
export function buildFromUserAgent(ua: string): number | null {
  const m = new RegExp(`${BUILD_UA_TOKEN}(\\d+)`).exec(ua)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * The installed APK's versionCode, or null. Null means one of two things,
 * and callers must keep them apart: not the shell at all (`isNativeShell()`
 * is false), or a shell built before the number was stamped in — which is
 * an old build by definition.
 */
export function installedBuild(): number | null {
  if (!isNativeShell()) return null
  return buildFromUserAgent(navigator.userAgent)
}
