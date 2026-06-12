import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

const BRIDGE = (process.env.SERVER_BRIDGE_URL ?? "").replace(/\/$/, "")
const TOKEN  = process.env.SERVER_BRIDGE_TOKEN ?? ""

async function bridgeFetch(path: string, opts: RequestInit = {}) {
  if (!BRIDGE) return null
  const res = await fetch(`${BRIDGE}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return null
  return res.json()
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!BRIDGE) return NextResponse.json({ configured: false }, { status: 503 })

  const type = new URL(req.url).searchParams.get("type") ?? "system"

  try {
    if (type === "system")  return NextResponse.json(await bridgeFetch("/system")  ?? { error: "unreachable" })
    if (type === "docker")  return NextResponse.json(await bridgeFetch("/docker")  ?? [])
    if (type === "ping")    return NextResponse.json(await bridgeFetch("/ping")    ?? {})
    if (type === "nodes")   return NextResponse.json(await bridgeFetch("/nodes")   ?? [])
    return NextResponse.json({ error: "Unknown type" }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!BRIDGE) return NextResponse.json({ configured: false }, { status: 503 })

  const { containerId, action } = await req.json()
  if (!containerId || !["start", "stop", "restart"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  try {
    const data = await bridgeFetch(`/docker/${containerId}/${action}`, { method: "POST" })
    return NextResponse.json(data ?? { error: "unreachable" })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
