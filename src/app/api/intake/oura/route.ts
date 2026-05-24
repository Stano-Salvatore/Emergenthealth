import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const ML_RE = /(\d+)\s*ml/i

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ entries: [], totalMl: 0 })
  const userId = session.user.id
  const date = new URL(req.url).searchParams.get("date") ?? new Date().toISOString().split("T")[0]

  try {
    const rows = await prisma.$queryRaw<{ id: string; text: string | null; timestamp: Date }[]>`
      SELECT "id", "text", "timestamp" FROM "OuraTag"
      WHERE "userId" = ${userId} AND "day" = ${date} AND "text" IS NOT NULL AND "text" != ''
      ORDER BY "timestamp" ASC
    `
    const entries = rows
      .filter(r => ML_RE.test(r.text ?? ""))
      .map(r => {
        const m = r.text!.match(ML_RE)!
        return { id: r.id, text: r.text!, amountMl: parseInt(m[1]), timestamp: r.timestamp }
      })
    return NextResponse.json({ entries, totalMl: entries.reduce((s, e) => s + e.amountMl, 0) })
  } catch {
    return NextResponse.json({ entries: [], totalMl: 0 })
  }
}
