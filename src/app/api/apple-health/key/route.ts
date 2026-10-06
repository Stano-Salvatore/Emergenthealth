import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { createAppleHealthKey } from "@/lib/apple-health-key"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The settings card's view of the Apple Health connection: whether a key
// exists (never the key — only its hash is kept), when it was last used, and
// what the last run saved. POST makes a new key and returns it, once.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const [key, last, lastErr] = await Promise.all([
    prisma.appleHealthKey.findUnique({ where: { userId }, select: { hint: true, createdAt: true, lastUsedAt: true } }).catch(() => null),
    prisma.userPreference.findUnique({ where: { userId_key: { userId, key: "apple_health_last_sync" } }, select: { value: true } }).catch(() => null),
    prisma.userPreference.findUnique({ where: { userId_key: { userId, key: "apple_health_last_error" } }, select: { value: true } }).catch(() => null),
  ])
  const parse = (v: string | undefined): unknown => {
    try { return v ? JSON.parse(v) : null } catch { return null } // an unreadable record is no record
  }
  const lastSync = parse(last?.value)
  const lastError = parse(lastErr?.value)
  return NextResponse.json({
    hasKey: !!key,
    hint: key?.hint ?? null,
    createdAt: key?.createdAt ?? null,
    lastUsedAt: key?.lastUsedAt ?? null,
    lastSync,
    lastError,
  }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const key = await createAppleHealthKey(session.user.id)
  return NextResponse.json({ key }, { headers: { "Cache-Control": "no-store" } })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await prisma.appleHealthKey.deleteMany({ where: { userId: session.user.id } })
  // What was received goes with it: the card reads it as "connected".
  await prisma.userPreference.deleteMany({
    where: { userId: session.user.id, key: { in: ["apple_health_last_sync", "apple_health_last_error"] } },
  }).catch(() => null)
  return NextResponse.json({ ok: true })
}
