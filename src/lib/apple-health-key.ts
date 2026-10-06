import { createHash, randomBytes } from "node:crypto"
import { prisma } from "@/lib/prisma"

// The key an iPhone Shortcut sends Apple Health data with — one per account.
//
// It is made here and shown once; only its SHA-256 is stored, so a copy of the
// database can't post into anyone's health record. Making a new one replaces
// the old, which stops working at once. "No such key" and "could not look"
// stay different answers (401 and 503), as for the widget key.

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex")

/** Makes this account's key, replacing any before it. The only time the key itself exists outside the shortcut. */
export async function createAppleHealthKey(userId: string): Promise<string> {
  const key = `ah_${randomBytes(24).toString("base64url")}`
  const data = { tokenHash: hashKey(key), hint: key.slice(-4), lastUsedAt: null }
  await prisma.appleHealthKey.upsert({ where: { userId }, create: { userId, ...data }, update: data })
  return key
}

export type AppleHealthKeyResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 503; error: string }

export async function appleHealthKeyUser(key: string | null): Promise<AppleHealthKeyResult> {
  if (!key) return { ok: false, status: 401, error: "Missing key — add the Authorization header from Settings → Apple Health." }
  try {
    const row = await prisma.appleHealthKey.findUnique({ where: { tokenHash: hashKey(key) }, select: { userId: true } })
    return row ? { ok: true, userId: row.userId } : { ok: false, status: 401, error: "That key isn't valid — it may have been replaced. Copy the current one from Settings → Apple Health." }
  } catch (e) {
    console.error("[apple-health] key lookup failed", e instanceof Error ? e.message : e)
    return { ok: false, status: 503, error: "Temporarily unavailable — the next run will try again." }
  }
}
