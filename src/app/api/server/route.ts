import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import os from "node:os"

// ── Bridge mode (Vercel / remote) ─────────────────────────────────────────────
// Set SERVER_BRIDGE_URL to proxy requests to the docker/server-bridge service.
// Leave unset when self-hosted — direct system access is used instead.

const BRIDGE = (process.env.SERVER_BRIDGE_URL ?? "").replace(/\/$/, "")
const TOKEN  = process.env.SERVER_BRIDGE_TOKEN ?? ""

async function bridgeFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BRIDGE}${path}`, {
    ...opts,
    headers: { ...(opts.headers ?? {}), ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return null
  return res.json()
}

// ── Direct mode (self-hosted on Lenovo) ───────────────────────────────────────

async function getSystemDirect() {
  const {
    getCpuUsage, getRam, getTemps, getDisk, cpuHistory, ensureHistoryCollection,
  } = await import("@/lib/server-metrics")
  ensureHistoryCollection()
  const [cpu, temps, disk] = await Promise.all([getCpuUsage(), getTemps(), getDisk()])
  const ram = getRam()
  return {
    hostname: os.hostname(),
    cpu:  { usage: cpu, history: [...cpuHistory] },
    ram,
    temps,
    disk,
    uptime:  os.uptime(),
    loadAvg: os.loadavg(),
  }
}

async function getDockerDirect() {
  const { listContainers } = await import("@/lib/server-metrics")
  return listContainers()
}

async function getPingDirect() {
  const { pingServices } = await import("@/lib/server-metrics")
  let services: Record<string, string> = {}
  try { services = JSON.parse(process.env.PING_SERVICES ?? "{}") } catch {}
  return pingServices(services)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const type = new URL(req.url).searchParams.get("type") ?? "system"

  try {
    if (BRIDGE) {
      // ── Bridge mode ──────────────────────────────────────────────────────
      const pathMap: Record<string, string> = {
        system: "/system",
        docker: "/docker",
        ping:   "/ping",
        nodes:  "/nodes",
      }
      const bridgePath = pathMap[type]
      if (!bridgePath) return NextResponse.json({ error: "Unknown type" }, { status: 400 })
      const data = await bridgeFetch(bridgePath)
      return NextResponse.json(data ?? { error: "Bridge unreachable" })
    }

    // ── Direct mode ────────────────────────────────────────────────────────
    if (type === "system") return NextResponse.json(await getSystemDirect())
    if (type === "docker") return NextResponse.json(await getDockerDirect())
    if (type === "ping")   return NextResponse.json(await getPingDirect())
    if (type === "nodes")  return NextResponse.json([]) // nodes reported via push; N/A in direct mode
    return NextResponse.json({ error: "Unknown type" }, { status: 400 })

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { containerId, action } = await req.json() as { containerId: string; action: string }
  if (!containerId || !["start", "stop", "restart"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  try {
    if (BRIDGE) {
      const data = await bridgeFetch(`/docker/${containerId}/${action}`, { method: "POST" })
      return NextResponse.json(data ?? { error: "Bridge unreachable" })
    }

    const { containerAction } = await import("@/lib/server-metrics")
    const result = await containerAction(containerId, action as "start" | "stop" | "restart")
    return NextResponse.json(result)

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
