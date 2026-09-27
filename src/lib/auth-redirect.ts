// Where Auth.js may send the browser after sign-in or sign-out. Decided by
// parsed origin, never by string prefix: "https://our.app.attacker.tld" starts
// with "https://our.app", and a prefix check made the real sign-out page a
// springboard to a lookalike asking for the password.

/** The absolute URL, when `url` (absolute or a path) lands on our own origin; otherwise null. */
export function sameOriginUrl(url: string, baseUrl: string): string | null {
  try {
    const target = new URL(url, baseUrl)
    return target.origin === new URL(baseUrl).origin ? target.href : null
  } catch {
    return null
  }
}

export function resolveAuthRedirect(url: string, baseUrl: string): string {
  return sameOriginUrl(url, baseUrl) ?? baseUrl
}
