export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Accepts OwnTracks HTTP mode POSTs
// Configure OwnTracks: Mode=HTTP, URL=https://emergenthealth.vercel.app/api/location/track?token=YOUR_MCP_KEY
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get("token")
  if (!token) return NextResponse.json({}, { status: 401 })

  const key = await prisma.mcpApiKey.findUnique({ where: { token } })
  if (!key) return NextResponse.json({}, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({}) }

  // Only handle location events; ignore transitions, waypoints, etc.
  if (body._type !== "location") return NextResponse.json([])
  // Coordinates on the globe, or nothing: a string or an out-of-range value
  // is a 500 from Prisma, or a point in no place that every day view draws.
  if (typeof body.lat !== "number" || typeof body.lon !== "number" ||
      !Number.isFinite(body.lat) || !Number.isFinite(body.lon) ||
      Math.abs(body.lat) > 90 || Math.abs(body.lon) > 180) {
    return NextResponse.json([])
  }

  const trackedAt = typeof body.tst === "number" && Number.isFinite(body.tst)
    ? new Date(body.tst * 1000)
    : new Date()

  await prisma.locationPoint.create({
    data: {
      userId:    key.userId,
      lat:       body.lat as number,
      lng:       body.lon as number,
      accuracyM: typeof body.acc === "number" ? Math.round(body.acc) : null,
      altitudeM: typeof body.alt === "number" ? body.alt : null,
      speedKmh:  typeof body.vel === "number" ? body.vel : null,
      battPct:   typeof body.batt === "number" ? body.batt : null,
      trackedAt,
      source: "owntracks",
    },
  })

  // OwnTracks expects an array response (list of commands, empty = no commands)
  return NextResponse.json([])
}
