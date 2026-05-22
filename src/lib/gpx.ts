export interface GpxPoint {
  lat: number
  lon: number
  time: Date | null
  ele: number | null
}

export interface GpxTrack {
  points: GpxPoint[]
  distanceKm: number
  durationMin: number
  movingMin: number
  startTime: Date | null
  endTime: Date | null
  maxSpeedKmh: number
  avgSpeedKmh: number
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function parseGpx(xml: string): GpxTrack {
  const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g
  const points: GpxPoint[] = []
  let match
  while ((match = trkptRegex.exec(xml)) !== null) {
    const lat = parseFloat(match[1])
    const lon = parseFloat(match[2])
    const inner = match[3]
    const timeMatch = inner.match(/<time>([^<]+)<\/time>/)
    const eleMatch = inner.match(/<ele>([^<]+)<\/ele>/)
    points.push({
      lat, lon,
      time: timeMatch ? new Date(timeMatch[1]) : null,
      ele: eleMatch ? parseFloat(eleMatch[1]) : null,
    })
  }

  const empty: GpxTrack = {
    points, distanceKm: 0, durationMin: 0, movingMin: 0,
    startTime: null, endTime: null, maxSpeedKmh: 0, avgSpeedKmh: 0,
  }
  if (points.length < 2) return empty

  let totalKm = 0
  let movingMs = 0
  let maxSpeedKmh = 0

  for (let i = 1; i < points.length; i++) {
    const d = haversineKm(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon)
    totalKm += d
    if (points[i].time && points[i - 1].time) {
      const dtSec = (points[i].time!.getTime() - points[i - 1].time!.getTime()) / 1000
      if (dtSec > 0 && dtSec < 300 && d > 0.003) {
        movingMs += dtSec * 1000
        const spd = (d / dtSec) * 3600
        if (spd < 250) maxSpeedKmh = Math.max(maxSpeedKmh, spd)
      }
    }
  }

  const startTime = points[0].time
  const endTime = points[points.length - 1].time
  const durationMin = startTime && endTime ? (endTime.getTime() - startTime.getTime()) / 60000 : 0
  const movingMin = movingMs / 60000
  const avgSpeedKmh = movingMin > 0 ? totalKm / (movingMin / 60) : 0

  return { points, distanceKm: totalKm, durationMin, movingMin, startTime, endTime, maxSpeedKmh, avgSpeedKmh }
}

export function downsamplePoints(points: GpxPoint[], maxPts = 400): GpxPoint[] {
  if (points.length <= maxPts) return points
  const step = Math.ceil(points.length / maxPts)
  return points.filter((_, i) => i % step === 0 || i === points.length - 1)
}

export function trackToSvgPath(
  points: { lat: number; lon: number }[],
  width: number, height: number, padding: number,
): { pathD: string; startX: number; startY: number; endX: number; endY: number } | null {
  if (points.length < 2) return null
  const lats = points.map(p => p.lat)
  const lons = points.map(p => p.lon)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLon = Math.min(...lons), maxLon = Math.max(...lons)
  const latRange = maxLat - minLat || 0.0001
  const lonRange = maxLon - minLon || 0.0001
  const toX = (lon: number) => padding + ((lon - minLon) / lonRange) * (width - padding * 2)
  const toY = (lat: number) => height - padding - ((lat - minLat) / latRange) * (height - padding * 2)
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.lon).toFixed(1)} ${toY(p.lat).toFixed(1)}`).join(" ")
  return {
    pathD,
    startX: toX(points[0].lon),
    startY: toY(points[0].lat),
    endX: toX(points[points.length - 1].lon),
    endY: toY(points[points.length - 1].lat),
  }
}
