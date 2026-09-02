import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"

// One gate for every scheduled route.
//
// Every cron used to carry its own copy of `if (secret && header !== …)`,
// which reads as a check and is actually an off switch: with CRON_SECRET
// unset — a fresh deploy, a renamed variable — all eighteen routes became
// public endpoints that push notifications, send email and spend Opus calls
// for every user. Unconfigured now means closed, not open, and the comparison
// is constant-time so the secret can't be recovered a byte at a time.

function bearerMatches(header: string | null, secret: string): boolean {
  if (!header) return false
  const given = Buffer.from(header)
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * Returns a 401/503 response to send back, or null when the caller is the
 * scheduler. Usage at the top of a cron handler:
 *
 *   const denied = requireCronSecret(req)
 *   if (denied) return denied
 */
export function requireCronSecret(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 })
  }
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}

/** The same rule for shared-secret webhooks that carry their token in a custom header. */
export function headerSecretMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
