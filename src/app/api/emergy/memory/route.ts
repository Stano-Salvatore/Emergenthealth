import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Emergy's long-term memory (the `remember` tool writes it) was invisible —
// facts accumulated with no way to see or correct them. This exposes the
// list to Settings: read it, delete an entry that's wrong or stale.

const KEY = "emergy_memory"

async function readFacts(userId: string): Promise<string[]> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: KEY } },
    select: { value: true },
  }).catch(() => null)
  try {
    const parsed = row ? JSON.parse(row.value) : []
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === "string") : []
  } catch {
    return []
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ facts: await readFacts(session.user.id) })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { fact } = await req.json().catch(() => ({ fact: null }))
  if (typeof fact !== "string" || !fact.trim()) {
    return NextResponse.json({ error: "fact is required" }, { status: 400 })
  }

  const facts = (await readFacts(userId)).filter(f => f !== fact)
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: KEY } },
    create: { userId, key: KEY, value: JSON.stringify(facts) },
    update: { value: JSON.stringify(facts) },
  }).catch(() => null)

  return NextResponse.json({ facts })
}
