import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { userDay } from "@/lib/user-timezone"

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

  const { today: todayStr, start: todayStart } = await userDay(userId)

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
