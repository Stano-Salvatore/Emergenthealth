import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { metricId, date, value, note } = await req.json()
  if (!metricId || value == null) return NextResponse.json({ error: "metricId and value required" }, { status: 400 })

  const dateStr = date ?? new Date().toISOString().slice(0, 10)

  // Verify ownership
  const owns = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CustomMetric" WHERE "id" = ${metricId} AND "userId" = ${userId}
  `
  if (!owns.length) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const id = randomUUID()
  await prisma.$executeRaw`
    INSERT INTO "CustomMetricLog"("id","userId","metricId","date","value","note")
    VALUES (${id}, ${userId}, ${metricId}, ${dateStr}::date, ${Number(value)}, ${note ?? null})
    ON CONFLICT ("metricId","date") DO UPDATE SET "value" = EXCLUDED."value", "note" = EXCLUDED."note"
  `
  return NextResponse.json({ ok: true, id })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { metricId, date } = await req.json()
  if (!metricId || !date) return NextResponse.json({ error: "metricId and date required" }, { status: 400 })

  await prisma.$executeRaw`
    DELETE FROM "CustomMetricLog"
    WHERE "metricId" = ${metricId} AND "userId" = ${userId} AND "date" = ${date}::date
  `
  return NextResponse.json({ ok: true })
}
