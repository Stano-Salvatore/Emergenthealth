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
  const [key, last] = await Promise.all([
    prisma.appleHealthKey.findUnique({ where: { userId }, select: { hint: true, createdAt: true, lastUsedAt: true } }).catch(() => null),
    prisma.userPreference.findUnique({ where: { userId_key: { userId, key: "apple_health_last_sync" } }, select: { value: true } }).catch(() => null),
  ])
  let lastSync: unknown = null
  try { lastSync = last?.value ? JSON.parse(last.value) : null } catch { /* an unreadable record is no record */ }
  return NextResponse.json({
    hasKey: !!key,
    hint: key?.hint ?? null,
    createdAt: key?.createdAt ?? null,
    lastUsedAt: key?.lastUsedAt ?? null,
    lastSync,
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
  return NextResponse.json({ ok: true })
}
