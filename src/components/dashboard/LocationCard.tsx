import { auth } from "@/auth"
import { distanceM } from "@/lib/places"
import { getGpxTrackForDate } from "@/lib/google-drive"
import { downsamplePoints, trackToSvgPath } from "@/lib/gpx"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { MapPin, ChevronRight } from "lucide-react"
import { format } from "date-fns"
import { getUserTimezone } from "@/lib/user-timezone"
import { localDateStr, zonedDayRange } from "@/lib/local-date"

function TrackSvg({ points }: { points: { lat: number; lon: number }[] }) {
  // A glyph, not a map — see TrackFit. This strip is 3.1:1, and a north-south
  // day drawn to scale in it is a correct, useless sliver.
  const data = trackToSvgPath(points, 280, 90, 10, "fill")
  if (!data) return null
  return (
    <svg viewBox="0 0 280 90" className="w-full rounded-lg overflow-hidden"
      style={{ background: "color-mix(in srgb, var(--primary) 5%, transparent)" }}>
      <defs>
        <linearGradient id="tg" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style={{ stopColor: "var(--primary)" }} />
          <stop offset="100%" style={{ stopColor: "var(--primary)", stopOpacity: 0.6 }} />
        </linearGradient>
      </defs>
      <path d={data.pathD} fill="none" stroke="url(#tg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={data.startX} cy={data.startY} r="3.5" fill="#22c55e" />
      <circle cx={data.endX} cy={data.endY} r="3.5" fill="#f43f5e" />
    </svg>
  )
}

export async function LocationCard() {
  const session = await auth()
  if (!session?.user?.id) return null

  // Both the day and its boundaries in the user's timezone. Taken from UTC,
  // the card showed yesterday's track for the first hours of every morning,
  // and cut the evening off the one it did show.
  const timezone = await getUserTimezone(session.user.id)
  const today = localDateStr(timezone)
  const { start: dayStart, end: dayEnd } = zonedDayRange(timezone, today)

  const [track, ownTracksRows] = await Promise.all([
    getGpxTrackForDate(session.user.id, today).catch(() => null),
    prisma.locationPoint.findMany({
      where: { userId: session.user.id, trackedAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { trackedAt: "asc" },
      select: { lat: true, lng: true },
    }),
  ])

  const gpxPts = track ? downsamplePoints(track.points, 300).map(p => ({ lat: p.lat, lon: p.lon })) : []
  const otPts  = ownTracksRows.map(r => ({ lat: r.lat, lon: r.lng }))
  const pts    = gpxPts.length >= 2 ? gpxPts : otPts
  const hasData = pts.length >= 2

  const distanceKm = track?.distanceKm ?? calcKm(otPts)
  const movingMin  = track?.movingMin  ?? 0
  const avgSpeed   = track?.avgSpeedKmh ?? 0

  return (
    <Link href="/dashboard/location">
      <div className="card-health rounded-xl border px-4 py-3 hover:border-primary/40 transition-all cursor-pointer h-full group hover:shadow-lg hover:shadow-primary/5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-primary" /> Location
          </span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{format(new Date(), "MMM d")}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>

        {!hasData ? (
          <div className="h-[90px] rounded-lg bg-secondary/40 flex items-center justify-center">
            <p className="text-xs text-muted-foreground">No GPS data yet today</p>
          </div>
        ) : (
          <>
            <TrackSvg points={pts} />
            <div className="grid grid-cols-3 gap-2 mt-2.5">
              <div>
                <p className="text-[10px] text-muted-foreground">Distance</p>
                <p className="text-sm font-bold tabular-nums">{distanceKm.toFixed(1)} km</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Moving</p>
                <p className="text-sm font-bold tabular-nums">{Math.round(movingMin)} min</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Avg speed</p>
                <p className="text-sm font-bold tabular-nums">{avgSpeed.toFixed(1)} km/h</p>
              </div>
            </div>
          </>
        )}
      </div>
    </Link>
  )
}

function calcKm(pts: { lat: number; lon: number }[]): number {
  let m = 0
  for (let i = 1; i < pts.length; i++) m += distanceM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon)
  return m / 1000
}
