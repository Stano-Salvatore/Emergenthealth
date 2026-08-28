// Native push, so Emergy can pop out when the app isn't running.
//
// Web push already delivers his messages, but only to a browser: a service
// worker has no bridge to native code, so nothing it receives can raise the
// chat head. On this phone the subscription lives in Chrome, which is why
// those notifications arrive from Chrome and open Chrome.
//
// FCM lands in the app's own process instead, where a service can start the
// head. This is the only delivery path that works with the app closed.
//
// Data-only messages, deliberately. A message with a `notification` block is
// drawn by the system tray when the app is backgrounded and never reaches our
// handler — which is exactly the case that matters. Data-only always reaches
// onMessageReceived, and the app decides what to show.

import { createSign } from "node:crypto"
import { prisma } from "@/lib/prisma"

export interface FcmPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
}

/** Parsed once. Absent config is a normal state, not an error. */
export function loadServiceAccount(raw: string | undefined = process.env.FCM_SERVICE_ACCOUNT): ServiceAccount | null {
  if (!raw) return null
  try {
    // Accepts either raw JSON or base64 — a private key pasted into an env var
    // survives base64 far more reliably than it survives newline handling.
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")
    const parsed = JSON.parse(text)
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null
    return {
      project_id: String(parsed.project_id),
      client_email: String(parsed.client_email),
      // Escaped newlines are what you get when a key goes through a form field.
      private_key: String(parsed.private_key).replace(/\\n/g, "\n"),
    }
  } catch {
    return null
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * A signed assertion that we are who the service account says we are.
 *
 * Hand-rolled rather than pulling in google-auth-library: it is three base64
 * segments and one RS256 signature, and the shape is pinned by tests.
 */
export function buildJwt(account: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }))
  const signer = createSign("RSA-SHA256")
  signer.update(`${header}.${claims}`)
  return `${header}.${claims}.${base64url(signer.sign(account.private_key))}`
}

let cachedToken: { value: string; expiresAt: number } | null = null

async function accessToken(account: ServiceAccount): Promise<string | null> {
  // A minute of slack: a token that expires mid-flight fails the send, and
  // re-minting costs one request an hour.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: buildJwt(account),
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    if (!json.access_token) return null
    cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    }
    return cachedToken.value
  } catch {
    return null
  }
}

/** The message body FCM expects. Data-only — see the note at the top. */
export function buildMessage(token: string, payload: FcmPayload): Record<string, unknown> {
  return {
    message: {
      token,
      data: {
        title: payload.title,
        body: payload.body,
        ...(payload.url ? { url: payload.url } : {}),
        ...(payload.tag ? { tag: payload.tag } : {}),
      },
      android: {
        // Without high priority a data message can be held until the device
        // next wakes, which for a reminder is the same as not sending it.
        priority: "HIGH",
      },
    },
  }
}

/**
 * A token the device has thrown away, as opposed to a send that merely failed.
 *
 * Only the first kind should be deleted. Treating a network blip as a dead
 * token would unregister a working phone, and nothing would say why it went
 * quiet — the same failure this app keeps finding in other clothes.
 */
export function isDeadToken(status: number, body: string): boolean {
  if (status === 404) return true
  if (status === 400 && /INVALID_ARGUMENT/.test(body) && /token/i.test(body)) return true
  if (status === 403 && /SenderId mismatch/i.test(body)) return true
  return false
}

export interface FcmResult {
  delivered: number
  deadTokens: string[]
}

/** Send to each token. Never throws: a push failing must not fail its cron. */
export async function sendFcm(tokens: string[], payload: FcmPayload): Promise<FcmResult> {
  const account = loadServiceAccount()
  if (!account || tokens.length === 0) return { delivered: 0, deadTokens: [] }

  const bearer = await accessToken(account)
  if (!bearer) return { delivered: 0, deadTokens: [] }

  const url = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`
  const dead: string[] = []
  let delivered = 0

  await Promise.allSettled(tokens.map(async token => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildMessage(token, payload)),
      })
      if (res.ok) { delivered++; return }
      const text = await res.text().catch(() => "")
      if (isDeadToken(res.status, text)) dead.push(token)
    } catch {
      // Network. Not the token's fault, so it stays registered.
    }
  }))

  return { delivered, deadTokens: dead }
}

/** Whether native push is configured at all, for the settings screen to say so. */
export function fcmConfigured(): boolean {
  return loadServiceAccount() != null
}

/**
 * Where device tokens live.
 *
 * Raw SQL and CREATE IF NOT EXISTS, the same as the other tables this app
 * added after its schema was set. One row per device, not per user: a token
 * identifies an install, and a person can have more than one.
 */
export async function ensureFcmTable(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "FcmToken" (
      "token"     TEXT PRIMARY KEY,
      "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "FcmToken_userId_idx" ON "FcmToken"("userId")
  `
}

/**
 * Register a device.
 *
 * The token is the primary key: FCM reissues them, and the same install
 * re-registering must move to the current user rather than accumulating rows
 * that all point at one phone.
 */
/**
 * How many app installs this account can be reached at.
 *
 * FcmToken is a raw table created on demand by ensureTable, so a fresh
 * database has none — counting must survive that rather than erroring into a
 * settings screen.
 */
export async function countFcmTokens(userId: string): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM "FcmToken" WHERE "userId" = ${userId}
    `
    return Number(rows[0]?.n ?? 0)
  } catch {
    return 0
  }
}

export async function saveFcmToken(userId: string, token: string): Promise<void> {
  await ensureFcmTable()
  await prisma.$executeRaw`
    INSERT INTO "FcmToken" ("token", "userId", "updatedAt")
    VALUES (${token}, ${userId}, NOW())
    ON CONFLICT ("token") DO UPDATE
      SET "userId" = EXCLUDED."userId", "updatedAt" = NOW()
  `
}
