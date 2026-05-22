import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { getGpxTrackForDate, listGpxDates } from "@/lib/google-drive"
import { downsamplePoints } from "@/lib/gpx"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)

  if (searchParams.get("list") === "1") {
    const dates = await listGpxDates(session.user.id)
    return NextResponse.json(dates)
  }

  const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0]
  const track = await getGpxTrackForDate(session.user.id, date)
  if (!track) return NextResponse.json(null)

  return NextResponse.json({
    distanceKm: track.distanceKm,
    durationMin: track.durationMin,
    movingMin: track.movingMin,
    maxSpeedKmh: track.maxSpeedKmh,
    avgSpeedKmh: track.avgSpeedKmh,
    startTime: track.startTime?.toISOString() ?? null,
    endTime: track.endTime?.toISOString() ?? null,
    points: downsamplePoints(track.points, 400).map(p => ({ lat: p.lat, lon: p.lon })),
  })
}
