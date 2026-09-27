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
  /** Client address of the browser that finished sign-in. */
  i?: string
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
  if (data.i !== undefined && typeof data.i !== "string") return null
  if (Date.now() > data.x) return null
  return data
}

/**
 * Whoever starts a mobile sign-in chooses its auth_key, so knowing the key
 * proves nothing: a stranger can mint one, send the owner the sign-in link,
 * and wait. What they cannot share is the phone. The Custom Tab that finished
 * Google sign-in and the WebView that redeems sit on one device and leave from
 * one address; a redeem from anywhere else is refused.
 */
export function mayRedeemFrom(code: SessionCode, ip: string): boolean {
  if (typeof code.i !== "string") return false
  const a = parseIp(code.i)
  const b = parseIp(ip)
  if (!a || !b) return false
  // Custom Tab and WebView can leave over different families; there is no
  // honest comparison across them, and refusing locked the owner out.
  if (a.v6 !== b.v6) return true
  return a.network === b.network
}

/**
 * The part of an address that stays put for one phone on one network: the
 * whole IPv4 address, or the /64 of an IPv6 one (Android rotates privacy
 * addresses inside it).
 */
function parseIp(raw: string): { v6: boolean; network: string } | null {
  const ip = raw.trim().replace(/^::ffff:(?=\d+\.)/i, "")
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return { v6: false, network: ip }
  if (!ip.includes(":")) return null
  const [head, tail = ""] = ip.toLowerCase().split("::")
  const left = head ? head.split(":") : []
  const right = tail ? tail.split(":") : []
  if (!ip.includes("::") && left.length !== 8) return null
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return { v6: true, network: groups.slice(0, 4).map(g => parseInt(g, 16).toString(16)).join(":") }
}

/** A mobile auth key is a UUID the native app minted — nothing else is honoured. */
export const AUTH_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isAuthKey(value: string | null | undefined): value is string {
  return typeof value === "string" && AUTH_KEY_RE.test(value)
}

/** Name of the cookie that binds a pending mobile sign-in to the browser that started it. */
export const MOBILE_AUTH_COOKIE = "mobile_auth_key"
