import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { subDays } from "date-fns"

const HEADERS = [
  "date",
  "sleepDuration",
  "deepSleep",
  "remSleep",
  "lightSleep",
  "steps",
  "restingHR",
  "hrv",
  "readinessScore",
  "sleepScore",
  "activityScore",
  "spo2",
  "caloriesBurned",
  "activeMinutes",
  "distanceKm",
  "stressHigh",
  "recoveryHigh",
] as const

type Col = (typeof HEADERS)[number]

function cell(value: string | number | null | undefined): string {
  if (value == null) return ""
  return String(value)
}

function toRow(log: Record<Col | "date", unknown>): string {
  return HEADERS.map((col) => cell(log[col] as string | number | null | undefined)).join(",")
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 })
  }
  const userId = session.user.id

  const since = subDays(new Date(), 90)

  const logs = await prisma.healthLog.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: "asc" },
    select: {
      date: true,
      sleepDuration: true,
      deepSleep: true,
      remSleep: true,
      lightSleep: true,
      steps: true,
      restingHR: true,
      hrv: true,
      readinessScore: true,
      sleepScore: true,
      activityScore: true,
      spo2: true,
      caloriesBurned: true,
      activeMinutes: true,
      distanceKm: true,
      stressHigh: true,
      recoveryHigh: true,
    },
  })

  const rows: string[] = [HEADERS.join(",")]

  for (const log of logs) {
    const dateStr = log.date instanceof Date
      ? log.date.toISOString().split("T")[0]
      : String(log.date)

    rows.push(toRow({ ...log, date: dateStr }))
  }

  const csv = rows.join("\r\n") + "\r\n"

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="health-export.csv"',
    },
  })
}
