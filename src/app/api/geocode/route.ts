import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

const UA = "emergenthealth/1.0 (health dashboard)"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)

  // ── Forward search: ?q=place+name ────────────────────────────────────────
  const q = searchParams.get("q")
  if (q) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=4&addressdetails=1`
    const res = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null)
    if (!res?.ok) return NextResponse.json({ error: "Search failed" }, { status: 502 })
    const results = await res.json() as { lat: string; lon: string; display_name: string; address?: Record<string, string> }[]
    return NextResponse.json(results.map(r => ({
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      label: r.display_name,
    })))
  }

  // ── Reverse geocode: ?lat=&lon= ───────────────────────────────────────────
  const lat = searchParams.get("lat")
  const lon = searchParams.get("lon")
  if (!lat || !lon) return NextResponse.json({ error: "lat and lon required" }, { status: 400 })

  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`
  const res = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null)
  if (!res?.ok) return NextResponse.json({ error: "Geocoding failed" }, { status: 502 })

  const data = await res.json()
  const a = data.address ?? {}
  const neighbourhood = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.village ?? null
  const city = a.city ?? a.town ?? a.municipality ?? a.county ?? null
  const country = a.country ?? null

  let place = ""
  if (neighbourhood && city) place = `${neighbourhood}, ${city}`
  else if (city && country) place = `${city}, ${country}`
  else place = data.display_name?.split(",").slice(0, 2).join(",").trim() ?? "Unknown location"

  return NextResponse.json({ place, neighbourhood, city, country, lat: parseFloat(lat), lon: parseFloat(lon) })
}
