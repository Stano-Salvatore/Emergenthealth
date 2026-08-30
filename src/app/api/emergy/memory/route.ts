import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { MEMORY_KEY, parseFacts, serialiseFacts, type MemoryFact } from "@/lib/emergy-memory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Emergy's long-term memory (the `remember` tool writes it, `forget` removes
// from it) was invisible — facts accumulated with no way to see or correct
// them. This exposes the list to Settings: read it, delete an entry that's
// wrong or stale.
//
// Parsing lives in lib/emergy-memory, which reads both the bare string array
// facts were first stored as and the dated objects they are now. Two parsers
// for one row is how a format migration quietly loses half of it.

async function readFacts(userId: string): Promise<MemoryFact[]> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: MEMORY_KEY } },
    select: { value: true },
  }).catch(() => null)
  return parseFacts(row?.value)
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const entries = await readFacts(session.user.id)
  // `facts` stays a plain string array: it is what the Settings list renders
  // and what DELETE matches on. `entries` carries the dates alongside it.
  return NextResponse.json({ facts: entries.map(e => e.fact), entries })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { fact } = await req.json().catch(() => ({ fact: null }))
  if (typeof fact !== "string" || !fact.trim()) {
    return NextResponse.json({ error: "fact is required" }, { status: 400 })
  }

  const entries = (await readFacts(userId)).filter(f => f.fact !== fact)
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: MEMORY_KEY } },
    create: { userId, key: MEMORY_KEY, value: serialiseFacts(entries) },
    update: { value: serialiseFacts(entries) },
  }).catch(() => null)

  return NextResponse.json({ facts: entries.map(e => e.fact), entries })
}
