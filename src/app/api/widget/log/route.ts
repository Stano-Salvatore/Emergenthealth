import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const ALLOWED_TYPES = ["water", "coffee", "beer", "wine"] as const
type AllowedType = (typeof ALLOWED_TYPES)[number]

async function resolveUserByApiKey(apiKey: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "UserPreference"
    WHERE "key" = 'widget_api_key' AND "value" = ${apiKey}
    LIMIT 1
  `.catch(() => [] as { userId: string }[])
  return rows[0]?.userId ?? null
}

export async function POST(req: NextRequest) {
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

  let body: { type?: unknown; amountMl?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { type, amountMl } = body

  if (!type || !ALLOWED_TYPES.includes(type as AllowedType)) {
    return NextResponse.json(
      { error: `type must be one of: ${ALLOWED_TYPES.join(", ")}` },
      { status: 400 }
    )
  }

  if (typeof amountMl !== "number" || amountMl <= 0) {
    return NextResponse.json({ error: "amountMl must be a positive number" }, { status: 400 })
  }

  await prisma.intakeLog.create({
    data: {
      userId,
      type: type as string,
      amountMl: Math.round(amountMl),
    },
  })

  return NextResponse.json({ ok: true, type, amountMl })
}
