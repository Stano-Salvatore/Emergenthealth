// Signed-in sessions, as Settings shows them.
//
// Sessions are database rows (Auth.js "database" strategy), so ending one is
// deleting its row — the cookie on that device then points at nothing. The
// browser is never given a token: seeing another device's token would be
// enough to become that device.

export const SESSION_COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"] as const

export interface SessionRow {
  id: string
  sessionToken: string
  createdAt: Date
  updatedAt: Date
  expires: Date
}

export interface SessionView {
  id: string
  signedInAt: string
  /** Auth.js refreshes a session at most once a day, so this is "active that day", not a live clock. */
  lastActiveAt: string
  expiresAt: string
  current: boolean
}

/** The session this request is signed in with, from whichever cookie name is in use. */
export function currentSessionToken(jar: { get(name: string): { value: string } | undefined }): string | undefined {
  for (const name of SESSION_COOKIE_NAMES) {
    const v = jar.get(name)?.value
    if (v) return v
  }
  return undefined
}

export function sessionViews(rows: SessionRow[], currentToken: string | undefined, now = new Date()): SessionView[] {
  return rows
    .filter(r => r.expires > now)
    .map(r => ({
      id: r.id,
      signedInAt: r.createdAt.toISOString(),
      lastActiveAt: r.updatedAt.toISOString(),
      expiresAt: r.expires.toISOString(),
      current: !!currentToken && r.sessionToken === currentToken,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt))
}
