import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"
import { userToday } from "@/lib/user-timezone"

export async function getRescuetimeKey(userId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ apiKey: string }[]>`
    SELECT "apiKey" FROM "RescuetimeKey" WHERE "userId" = ${userId} LIMIT 1
  `.catch(() => [] as { apiKey: string }[])
  return rows[0]?.apiKey ?? null
}

interface RescuetimeRow {
  date: string
  seconds: number
  productivity: number
  category: string
}

export async function syncRescuetime(userId: string, apiKey: string): Promise<{ synced: number }> {
  // The user's day, not the server's: an end bound of UTC-today is yesterday
  // for the first hours of every morning east of Greenwich, which drops the
  // day being looked at from the window.
  const today = await userToday(userId)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  const url = `https://www.rescuetime.com/anapi/data?key=${encodeURIComponent(apiKey)}&perspective=interval&resolution_time=day&format=json&restrict_kind=overview&restrict_begin=${thirtyDaysAgo}&restrict_end=${today}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`RescueTime API error: ${res.status}`)

  const data = await res.json() as { rows?: unknown[][] }
  const rawRows = data.rows ?? []

  const byDate: Record<string, { productiveS: number; neutralS: number; distractingS: number; topCategory: string | null }> = {}

  for (const row of rawRows) {
    if (!Array.isArray(row) || row.length < 4) continue
    const parsed: RescuetimeRow = {
      date: String(row[0]).slice(0, 10),
      seconds: Number(row[1]) || 0,
      productivity: Number(row[3]) || 0,
      category: String(row[4] ?? ""),
    }

    if (!byDate[parsed.date]) {
      byDate[parsed.date] = { productiveS: 0, neutralS: 0, distractingS: 0, topCategory: null }
    }

    const bucket = byDate[parsed.date]
    if (parsed.productivity >= 1) {
      bucket.productiveS += parsed.seconds
    } else if (parsed.productivity <= -1) {
      bucket.distractingS += parsed.seconds
    } else {
      bucket.neutralS += parsed.seconds
    }

    if (!bucket.topCategory && parsed.category) {
      bucket.topCategory = parsed.category
    }
  }

  let synced = 0
  for (const [date, bucket] of Object.entries(byDate)) {
    const totalS = bucket.productiveS + bucket.neutralS + bucket.distractingS
    const totalH = totalS / 3600
    const productiveH = bucket.productiveS / 3600
    const neutralH = bucket.neutralS / 3600
    const distractingH = bucket.distractingS / 3600
    const productivityScore = totalS > 0 ? Math.round(((bucket.productiveS - bucket.distractingS) / totalS) * 100 + 50) : null
    const id = randomUUID()

    await prisma.$executeRaw`
      INSERT INTO "RescuetimeLog" ("id", "userId", "date", "productivityScore", "totalActiveH", "productiveH", "neutralH", "distractingH", "topCategory")
      VALUES (${id}, ${userId}, ${date}, ${productivityScore}, ${totalH}, ${productiveH}, ${neutralH}, ${distractingH}, ${bucket.topCategory})
      ON CONFLICT ("userId", "date") DO UPDATE
        SET "productivityScore" = EXCLUDED."productivityScore",
            "totalActiveH"      = EXCLUDED."totalActiveH",
            "productiveH"       = EXCLUDED."productiveH",
            "neutralH"          = EXCLUDED."neutralH",
            "distractingH"      = EXCLUDED."distractingH",
            "topCategory"       = EXCLUDED."topCategory"
    `
    synced++
  }

  return { synced }
}
