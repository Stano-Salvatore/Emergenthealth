import { auth } from "@/auth"
import { getGpxTrackForDate } from "@/lib/google-drive"
import { downsamplePoints, trackToSvgPath } from "@/lib/gpx"
import Link from "next/link"
import { MapPin, ChevronRight } from "lucide-react"
import { format } from "date-fns"

function TrackSvg({ points }: { points: { lat: number; lon: number }[] }) {
  const data = trackToSvgPath(points, 280, 90, 10)
  if (!data) return null
  return (
    <svg viewBox="0 0 280 90" className="w-full rounded-lg overflow-hidden"
      style={{ background: "rgba(99,102,241,0.05)" }}>
      <defs>
        <linearGradient id="tg" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#a78bfa" />
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

  const today = new Date().toISOString().split("T")[0]
  const track = await getGpxTrackForDate(session.user.id, today).catch(() => null)
  const pts = track ? downsamplePoints(track.points, 300).map(p => ({ lat: p.lat, lon: p.lon })) : []
  const hasData = pts.length >= 2

  return (
    <Link href="/dashboard/location">
      <div className="card-health rounded-xl border px-4 py-3 hover:border-indigo-500/40 transition-all cursor-pointer h-full group hover:shadow-lg hover:shadow-indigo-500/5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-indigo-400" /> Location
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
                <p className="text-sm font-bold tabular-nums">{track!.distanceKm.toFixed(1)} km</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Moving</p>
                <p className="text-sm font-bold tabular-nums">{Math.round(track!.movingMin)} min</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Avg speed</p>
                <p className="text-sm font-bold tabular-nums">{track!.avgSpeedKmh.toFixed(1)} km/h</p>
              </div>
            </div>
          </>
        )}
      </div>
    </Link>
  )
}
