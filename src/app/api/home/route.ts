import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

const HA_URL = process.env.HA_URL
const HA_TOKEN = process.env.HA_TOKEN

function haHeaders() {
  return {
    Authorization: `Bearer ${HA_TOKEN}`,
    "Content-Type": "application/json",
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!HA_URL || !HA_TOKEN) {
    return NextResponse.json({ error: "HA_URL and HA_TOKEN not configured" }, { status: 503 })
  }

  try {
    const res = await fetch(`${HA_URL}/api/states`, { headers: haHeaders(), cache: "no-store" })
    if (!res.ok) throw new Error(`HA responded ${res.status}`)
    const states = await res.json()
    return NextResponse.json(states)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// Toggle a light/switch, or call any service
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!HA_URL || !HA_TOKEN) {
    return NextResponse.json({ error: "HA_URL and HA_TOKEN not configured" }, { status: 503 })
  }

  try {
    const { domain, service, entity_id } = await req.json()
    const res = await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
      method: "POST",
      headers: haHeaders(),
      body: JSON.stringify({ entity_id }),
    })
    if (!res.ok) throw new Error(`HA responded ${res.status}`)
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
