import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

async function resolveUserByApiKey(apiKey: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "UserPreference"
    WHERE "key" = 'widget_api_key' AND "value" = ${apiKey}
    LIMIT 1
  `.catch(() => [] as { userId: string }[])
  return rows[0]?.userId ?? null
}

export async function GET(req: NextRequest) {
  const apiKey =
    req.headers.get("x-widget-key") ??
    new URL(req.url).searchParams.get("key") ??
    ""

  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401 })
  }

  const userId = await resolveUserByApiKey(apiKey)
  if (!userId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 })
  }

  const now = new Date()
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  )
  const todayStr = todayStart.toISOString().split("T")[0]

  const logs = await prisma.intakeLog.findMany({
    where: {
      userId,
      loggedAt: { gte: todayStart },
    },
    select: { type: true, amountMl: true },
  })

  let waterMl = 0
  let coffeeMl = 0
  let beerCount = 0
  let wineCount = 0

  for (const log of logs) {
    if (log.type === "water") waterMl += log.amountMl
    else if (log.type === "coffee") coffeeMl += log.amountMl
    else if (log.type === "beer") beerCount += 1
    else if (log.type === "wine") wineCount += 1
  }

  return NextResponse.json({ waterMl, coffeeMl, beerCount, wineCount, date: todayStr })
}
