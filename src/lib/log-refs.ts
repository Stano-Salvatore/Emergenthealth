import { createHmac, timingSafeEqual } from "crypto"

// Letting Emergy delete things, without letting Emergy delete things.
//
// The ask was a confirmation step: Emergy proposes, the user says yes, only
// then does it happen. Putting that rule in the system prompt would not be
// worth much — a prompt is a request, and the model that is supposed to obey
// it is the same model that would be skipping it. Text inside a shared photo
// or a pasted message could ask it to skip too.
//
// So the rule lives here instead. delete_log does not delete. It looks the
// record up, describes it, and returns a token derived from AUTH_SECRET, which
// the model has no way to compute. Only a second call carrying that token
// removes anything. Emergy cannot shortcut the round trip through the user
// because it cannot produce the token, however it is asked.
//
// The token is bound to the exact record, so a confirmation for one dose can
// never be spent on another — even if the description Emergy read out was
// wrong, the delete lands on the row that was described.

/** Kinds of record Emergy may remove or correct. Anything absent is untouchable. */
export const REF_KINDS = ["dose", "intake", "moment"] as const
export type RefKind = (typeof REF_KINDS)[number]

export function isRefKind(v: string): v is RefKind {
  return (REF_KINDS as readonly string[]).includes(v)
}

/** `kind:id` — deliberately readable, since Emergy is meant to pass it back verbatim. */
export function makeRef(kind: RefKind, id: string): string {
  return `${kind}:${id}`
}

export function parseRef(ref: string): { kind: RefKind; id: string } | null {
  const idx = ref.indexOf(":")
  if (idx <= 0) return null
  const kind = ref.slice(0, idx)
  const id = ref.slice(idx + 1)
  if (!isRefKind(kind) || !id) return null
  return { kind, id }
}

// A confirmation should not stay spendable forever: "yes, delete it" from an
// hour ago is not consent to a delete now. Ten-minute buckets, with the
// previous one still accepted, give a 10–20 minute window — long enough for a
// real exchange, short enough that a stale token dies on its own.
const BUCKET_MS = 10 * 60_000

function tokenFor(userId: string, ref: string, bucket: number): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is required to confirm a deletion")
  return createHmac("sha256", secret)
    .update(`${userId}|${ref}|${bucket}`)
    .digest("base64url")
    .slice(0, 16)
}

export function issueConfirmToken(userId: string, ref: string, now = Date.now()): string {
  return tokenFor(userId, ref, Math.floor(now / BUCKET_MS))
}

export function verifyConfirmToken(
  userId: string, ref: string, token: string, now = Date.now(),
): boolean {
  if (!token) return false
  const bucket = Math.floor(now / BUCKET_MS)
  // Current and previous bucket, so a confirmation given just before a
  // boundary is not rejected a second later.
  return [bucket, bucket - 1].some(b => {
    const expected = tokenFor(userId, ref, b)
    if (expected.length !== token.length) return false
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  })
}
