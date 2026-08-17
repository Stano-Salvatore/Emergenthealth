// Whether this page is running inside the Android shell.
//
// Deliberately read from the user agent (capacitor.config.ts appends the
// suffix) rather than from Capacitor's bridge. The callers are all in the
// business of deciding whether to touch service workers, and one of them runs
// precisely when the bridge is what's broken — a check that needs the bridge
// to work would be useless exactly when it matters.
export const NATIVE_UA_MARKER = "Emergenthealth-Capacitor"

export function isNativeShell(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes(NATIVE_UA_MARKER)
}
