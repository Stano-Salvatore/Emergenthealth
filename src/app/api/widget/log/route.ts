import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { estimateCaffeine } from "@/lib/caffeine"

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

  let body: { type?: unknown; amountMl?: unknown; usual?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // { usual: true } — one home-screen tap logs the usual order of the saved
  // place. The widget can't ask which place, so it never errors on ambiguity:
  // last place checked in at → the only one with a usual → most recent.
  if (body.usual === true) {
    const places = await prisma.savedPlace.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    })
    const withUsual = places.filter(p => p.usualType && p.usualMl)
    if (withUsual.length === 0) {
      return NextResponse.json({ error: "No saved place has a usual order yet" }, { status: 400 })
    }
    const lastCheckin = await prisma.checkIn.findFirst({
      where: { userId, savedPlaceId: { in: withUsual.map(p => p.id) } },
      orderBy: { checkedAt: "desc" },
      select: { savedPlaceId: true },
    }).catch(() => null)
    const place = withUsual.find(p => p.id === lastCheckin?.savedPlaceId) ?? withUsual[0]

    const log = await prisma.intakeLog.create({
      data: {
        userId,
        type: place.usualType!,
        amountMl: place.usualMl!,
        note: `${place.usualNote || "the usual"} @ ${place.name}`,
      },
    })
    const usualEst = estimateCaffeine(place.usualType!, place.usualNote ?? "", place.usualMl!)
    if (usualEst) {
      await prisma.caffeineLog.create({
        data: { id: `intake_${log.id}`, userId, compound: usualEst.compound, caffeineMg: usualEst.mg },
      }).catch(() => null)
    }
    return NextResponse.json({
      ok: true,
      type: place.usualType,
      amountMl: place.usualMl,
      place: place.name,
      label: place.usualNote || place.usualType,
    })
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

  const log = await prisma.intakeLog.create({
    data: {
      userId,
      type: type as string,
      amountMl: Math.round(amountMl),
    },
  })

  // caffeinated drinks auto-feed the caffeine tracker (same as /api/intake)
  const est = estimateCaffeine(type as string, "", Math.round(amountMl))
  if (est) {
    await prisma.caffeineLog.create({
      data: { id: `intake_${log.id}`, userId, compound: est.compound, caffeineMg: est.mg },
    }).catch(() => null)
  }

  return NextResponse.json({ ok: true, type, amountMl })
}
