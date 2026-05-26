import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const lat = searchParams.get("lat")
  const lon = searchParams.get("lon")
  if (!lat || !lon) return NextResponse.json({ error: "lat and lon required" }, { status: 400 })

  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`
  const res = await fetch(url, {
    headers: { "User-Agent": "emergenthealth/1.0 (health dashboard)" },
  }).catch(() => null)

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
