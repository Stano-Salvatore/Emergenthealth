import { createHmac, timingSafeEqual } from "crypto"

// The signed, short-lived envelope the mobile sign-in bridge hands a session
// cookie across in: Chrome (which completed Google OAuth) writes it, the
// WebView redeems it. One implementation, so the two ends can't drift — they
// had, and one of them compared the signature with `!==`.

export interface SessionCode {
  /** The session cookie value. */
  t: string
  /** The cookie name it belongs under (Auth.js uses a __Secure- prefix on HTTPS). */
  n: string
  /** Unix ms after which the code is dead even if the row outlives it. */
  x: number
}

export const SESSION_CODE_TTL_MS = 600_000 // 10 minutes

function secret(): string {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error("AUTH_SECRET is not configured")
  return s
}

export function signSessionCode(data: SessionCode): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url")
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url")
  return `${payload}~${sig}`
}

/** The data inside a code, or null for anything tampered, malformed or expired. */
export function verifySessionCode(code: string): SessionCode | null {
  const tilde = code.lastIndexOf("~")
  if (tilde === -1) return null
  const payload = code.slice(0, tilde)
  const sig = code.slice(tilde + 1)

  const expected = createHmac("sha256", secret()).update(payload).digest("base64url")
  const a = Buffer.from(sig, "base64url")
  const b = Buffer.from(expected, "base64url")
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let data: SessionCode
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString())
  } catch {
    return null
  }
  if (typeof data?.t !== "string" || typeof data.n !== "string" || typeof data.x !== "number") return null
  if (Date.now() > data.x) return null
  return data
}

/** A mobile auth key is a UUID the native app minted — nothing else is honoured. */
export const AUTH_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isAuthKey(value: string | null | undefined): value is string {
  return typeof value === "string" && AUTH_KEY_RE.test(value)
}

/** Name of the cookie that binds a pending mobile sign-in to the browser that started it. */
export const MOBILE_AUTH_COOKIE = "mobile_auth_key"
