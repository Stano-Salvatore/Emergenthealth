import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const results: {
    sdm?: unknown; ewelink?: unknown; tuya?: unknown; ewpe?: unknown; rowenta?: unknown
    sdmError?: string; ewelinkError?: string; tuyaError?: string; ewpeError?: string; rowentaError?: string
  } = {}

  // ── Google Nest (SDM) ─────────────────────────────────────────────────────
  if (process.env.SDM_PROJECT_ID) {
    try {
      const { getSmartDevices } = await import("@/lib/google-home")
      results.sdm = await getSmartDevices(session.user.id)
    } catch (e: unknown) {
      results.sdmError = e instanceof Error ? e.message : String(e)
    }
  }

  // ── eWeLink / Sonoff RF Bridge ────────────────────────────────────────────
  if (process.env.EWELINK_EMAIL) {
    try {
      const { getDevices } = await import("@/lib/ewelink")
      results.ewelink = await getDevices()
    } catch (e: unknown) {
      results.ewelinkError = e instanceof Error ? e.message : String(e)
    }
  }

  // ── Tuya / Smart Life ─────────────────────────────────────────────────────
  if (process.env.TUYA_CLIENT_ID) {
    try {
      const { getTuyaDevices } = await import("@/lib/tuya")
      results.tuya = await getTuyaDevices()
    } catch (e: unknown) {
      results.tuyaError = e instanceof Error ? e.message : String(e)
    }
  }

  // ── EWPE Smart / Sinclair AC ─────────────────────────────────────────────
  if (process.env.EWPE_EMAIL) {
    try {
      const { getAcDevices } = await import("@/lib/ewpe-smart")
      const { devices, loginError } = await getAcDevices()
      results.ewpe = devices
      if (loginError) results.ewpeError = loginError
    } catch (e: unknown) {
      results.ewpeError = e instanceof Error ? e.message : String(e)
    }
  }

  // ── Rowenta Vacuum (via bridge) ──────────────────────────────────────────────
  const bridgeUrl = process.env.EWPE_API_URL?.replace(/\/apiv2\/?$/, "") || process.env.BRIDGE_URL
  if (bridgeUrl) {
    try {
      const res = await fetch(`${bridgeUrl}/vacuum/status`, {
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      })
      results.rowenta = await res.json()
    } catch (e: unknown) {
      results.rowentaError = e instanceof Error ? e.message : String(e)
    }
  }

  if (!process.env.SDM_PROJECT_ID && !process.env.EWELINK_EMAIL && !process.env.TUYA_CLIENT_ID && !process.env.EWPE_EMAIL) {
    return NextResponse.json({ error: "No home integrations configured" }, { status: 503 })
  }

  return NextResponse.json(results)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()

  if (body.type === "ewelink_rf") {
    const { transmitRf } = await import("@/lib/ewelink")
    await transmitRf(body.deviceId, body.rfChl)
    return NextResponse.json({ success: true })
  }

  if (body.type === "sdm") {
    const { executeCommand } = await import("@/lib/google-home")
    await executeCommand(session.user.id, body.deviceName, body.command, body.params)
    return NextResponse.json({ success: true })
  }

  if (body.type === "tuya") {
    const { controlTuya } = await import("@/lib/tuya")
    await controlTuya(body.deviceId, body.commands)
    return NextResponse.json({ success: true })
  }

  if (body.type === "ewpe") {
    const { controlAc } = await import("@/lib/ewpe-smart")
    await controlAc(body.deviceId, body.attrs)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: "Unknown action type" }, { status: 400 })
}
