// EWPE Smart / Gree Cloud API — reverse-engineered from the mobile app
// Works for Sinclair, Gree, and other OEM AC brands using the EWPE Smart / Gree+ app
//
// NOTE: Gree cloud servers block datacenter IPs (like Vercel).
// If you see "All EWPE endpoints unreachable", run scripts/ewpe-bridge.mjs
// on your home PC, expose it via Cloudflare Tunnel, and set:
//   EWPE_API_URL=https://<your-tunnel>.trycloudflare.com/apiv2

import { createHash } from "crypto"

// Try multiple known Gree cloud endpoints — override with EWPE_API_URL if needed
// eugrih.gree.com is the real EU endpoint (CNAME → AWS eu-central-1 Frankfurt)
// BRIDGE_URL points to the local Cloudflare tunnel bridge running on your home PC
const CANDIDATES = [
  process.env.EWPE_API_URL,
  process.env.BRIDGE_URL ? `${process.env.BRIDGE_URL.replace(/\/+$/, "")}/apiv2` : undefined,
  "https://eugrih.gree.com/apiv2",
  "https://openapi.gree.com/apiv2",
  "https://euapi.gree.com/apiv2",
  "https://account.gree.com/apiv2",
].filter(Boolean) as string[]

// Credentials embedded in the EWPE Smart / Gree+ app
const APP_CLIENT_ID     = "8e6e58b4-c539-48b7-98c9-bd26699d4a04"
const APP_CLIENT_SECRET = "f2d95a79-6e68-4b24-b01d-195e34f7e71b"

let cached: { uid: string; token: string; base: string; expiresAt: number } | null = null

function md5(str: string) {
  return createHash("md5").update(str).digest("hex")
}

async function tryLogin(base: string, email: string, password: string) {
  try {
    const res = await fetch(`${base}/account/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username:      email,
        password:      md5(password),
        client_id:     APP_CLIENT_ID,
        client_secret: APP_CLIENT_SECRET,
        appversion:    "4.0.0",
        version:       "0.4.0",
      }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json()
    if (data.status === 1) return { uid: String(data.data.uid), token: String(data.data.token) }
    return null
  } catch { return null }
}

async function login(): Promise<{ uid: string; token: string; base: string }> {
  if (cached && cached.expiresAt > Date.now() + 60_000)
    return { uid: cached.uid, token: cached.token, base: cached.base }

  const email    = process.env.EWPE_EMAIL
  const password = process.env.EWPE_PASSWORD
  if (!email || !password) throw new Error("EWPE_EMAIL and EWPE_PASSWORD not configured")

  for (const base of CANDIDATES) {
    const result = await tryLogin(base, email, password)
    if (result) {
      cached = { ...result, base, expiresAt: Date.now() + 60 * 60 * 1000 }
      return { ...result, base }
    }
  }

  throw new Error(`All EWPE endpoints unreachable (tried: ${CANDIDATES.join(", ")})`)
}

export interface AcDevice {
  deviceId:  string
  deviceName: string
  mac:        string
  online:     boolean
  attrs?: AcAttrs
}

export interface AcAttrs {
  Pow:    number   // 0=off 1=on
  Mod:    number   // 0=auto 1=cool 2=dry 3=fan 4=heat
  SetTem: number   // target temp °C
  TemSen: number   // current temp °C (ambient sensor)
  WdSpd:  number   // 0=auto 1–5=speed
  Air:    number   // 0/1 fresh air
  Tur:    number   // 0/1 turbo
  Quiet:  number   // 0/1 quiet mode
  SwingLfRig: number // horizontal swing
  SwUpDn:    number  // vertical swing
}

export async function getAcDevices(): Promise<{ devices: AcDevice[]; loginError?: string }> {
  const hardcodedId   = process.env.EWPE_DEVICE_ID
  const hardcodedName = process.env.EWPE_DEVICE_NAME ?? "Sinclair AC"

  let discovered: AcDevice[] = []
  let loginError: string | undefined

  try {
    const { uid, token, base } = await login()

    const res = await fetch(`${base}/binding/getUserDeviceList`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, token }),
      cache: "no-store",
    })

    const data = await res.json()
    if (data.status === 1) {
      discovered = (data.data?.devices ?? data.data ?? []).map((d: Record<string, unknown>) => ({
        deviceId:   String(d.deviceId ?? d.mac),
        deviceName: String(d.deviceName ?? d.alias ?? "AC"),
        mac:        String(d.mac ?? ""),
        online:     Boolean(d.online ?? d.isOnline ?? true),
      }))

      await Promise.all(discovered.map(async (dev) => {
        try { dev.attrs = await getDeviceStatus(dev.deviceId, uid, token, base) } catch { /* ignore */ }
      }))
    } else {
      loginError = `Device list failed: ${data.msg ?? JSON.stringify(data)}`
    }

    // Merge hardcoded device if not already in list
    if (hardcodedId && !discovered.find((d) => d.deviceId === hardcodedId || d.mac === hardcodedId)) {
      const dev: AcDevice = { deviceId: hardcodedId, deviceName: hardcodedName, mac: hardcodedId, online: true }
      try { dev.attrs = await getDeviceStatus(hardcodedId, uid, token, base) } catch { /* ignore */ }
      discovered.push(dev)
    }
  } catch (e) {
    loginError = e instanceof Error ? e.message : String(e)
    if (hardcodedId) {
      discovered = [{ deviceId: hardcodedId, deviceName: hardcodedName, mac: hardcodedId, online: false }]
    }
  }

  return { devices: discovered, loginError }
}

async function getDeviceStatus(deviceId: string, uid: string, token: string, base: string): Promise<AcAttrs> {
  const res = await fetch(`${base}/aircon/devstatus`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, uid, token }),
  })
  const data = await res.json()
  return (data.data?.attrs ?? data.data ?? {}) as AcAttrs
}

export async function controlAc(deviceId: string, attrs: Partial<AcAttrs>): Promise<void> {
  const { uid, token, base } = await login()

  const res = await fetch(`${base}/aircon/devcontrol`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, uid, token, attrs }),
  })

  const data = await res.json()
  if (data.status !== 1) throw new Error(`EWPE control failed: ${data.msg ?? JSON.stringify(data)}`)
}

export const AC_MODES = ["Auto", "Cool", "Dry", "Fan", "Heat"] as const
export const FAN_SPEEDS = ["Auto", "1", "2", "3", "4", "5"] as const
