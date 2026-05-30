import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
    SELECT "key", "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" IN ('weather_lat', 'weather_lon', 'weather_label')
  `
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
  if (!map.weather_lat) return NextResponse.json({})
  return NextResponse.json({
    lat: parseFloat(map.weather_lat),
    lon: parseFloat(map.weather_lon ?? "0"),
    label: map.weather_label ?? null,
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const { lat, lon, label } = await req.json()

  for (const [key, value] of [
    ["weather_lat",   String(lat)],
    ["weather_lon",   String(lon)],
    ["weather_label", String(label ?? "")],
  ] as [string, string][]) {
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, ${key}, ${value})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
    `
  }
  return NextResponse.json({ ok: true })
}
