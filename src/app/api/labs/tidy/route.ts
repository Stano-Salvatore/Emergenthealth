import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { planLabTidy, type TidyPlan } from "@/lib/lab-recanonicalise"

// GET is the dry run the card shows; POST applies the renames and the signs
// moved out of notes, nothing else. The plan is always rebuilt here from the
// user's own rows — nothing the client sends decides what changes.

export const dynamic = "force-dynamic"

async function plan(userId: string): Promise<TidyPlan> {
  const rows = await prisma.labResult.findMany({
    where: { userId },
    orderBy: { date: "asc" },
    select: { id: true, marker: true, unit: true, value: true, date: true, notes: true, qualifier: true },
  })
  // Date-only column: the UTC slice is the draw date.
  return planLabTidy(rows.map(r => ({ ...r, date: r.date.toISOString().slice(0, 10) })))
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await plan(session.user.id))
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const p = await plan(userId)
  if (p.renames.length === 0 && p.limits.length === 0) {
    return NextResponse.json({ renamed: 0, limits: 0, needsALook: p.needsALook.length })
  }

  // Each write is conditioned on the row still holding what the plan read,
  // so a row changed in between is left alone rather than overwritten.
  const results = await prisma.$transaction([
    ...p.renames.map(r => prisma.labResult.updateMany({
      where: { id: r.id, userId, marker: r.from },
      data: { marker: r.to },
    })),
    ...p.limits.map(l => prisma.labResult.updateMany({
      where: { id: l.id, userId, qualifier: null },
      data: { qualifier: l.qualifier },
    })),
  ])
  const renamed = results.slice(0, p.renames.length).reduce((n, r) => n + r.count, 0)
  const limits = results.slice(p.renames.length).reduce((n, r) => n + r.count, 0)
  return NextResponse.json({ renamed, limits, needsALook: p.needsALook.length })
}
