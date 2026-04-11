// eWeLink Cloud API v2 integration for Sonoff RF Bridge R2
// Docs: https://coolkit-technologies.github.io/eWeLink-API/

const REGION = process.env.EWELINK_REGION ?? "eu"
const BASE = `https://${REGION}-apia.coolkit.cc`
const APP_ID = process.env.EWELINK_APP_ID ?? "oeVkj2lYFGnJrjOfAbbJaP3o6ixNNzy2"
const APP_SECRET = process.env.EWELINK_APP_SECRET ?? "6Nz4n0xA8s8qdxQf2GqurZj2Fs55FUvM"

let cachedToken: { at: string; expiresAt: number } | null = null

function nonce() {
  return Math.random().toString(36).slice(2, 10)
}

function baseHeaders(token?: string) {
  return {
    "Content-Type": "application/json",
    "X-CK-Appid": APP_ID,
    "X-CK-Nonce": nonce(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function getToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.at

  const email = process.env.EWELINK_EMAIL
  const password = process.env.EWELINK_PASSWORD
  if (!email || !password) throw new Error("EWELINK_EMAIL and EWELINK_PASSWORD not configured")

  const res = await fetch(`${BASE}/v2/user/login`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify({ email, password, countryCode: "+421" }),
  })

  const data = await res.json()
  if (data.error !== 0) throw new Error(`eWeLink login failed: ${data.msg ?? data.error}`)

  cachedToken = {
    at: data.data.at,
    expiresAt: now + 29 * 24 * 60 * 60 * 1000, // tokens last ~30 days
  }
  return cachedToken.at
}

export interface RfChannel {
  rfChl: number
  rfVal: string
}

export interface EwelinkDevice {
  deviceid: string
  name: string
  extra: { uiid: number }
  params: {
    rfList?: RfChannel[]
    rfTrig?: number
    online?: boolean
  }
  online: boolean
}

export async function getDevices(): Promise<EwelinkDevice[]> {
  const token = await getToken()

  const res = await fetch(`${BASE}/v2/device/thing?num=0`, {
    headers: baseHeaders(token),
    cache: "no-store",
  })

  const data = await res.json()
  if (data.error !== 0) throw new Error(`eWeLink devices failed: ${data.msg ?? data.error}`)

  // uiid 28 = RF Bridge
  const things = (data.data?.thingList ?? []) as Array<{ itemType: number; itemData: EwelinkDevice }>
  return things.filter((t) => t.itemType === 1).map((t) => t.itemData)
}

export async function transmitRf(deviceId: string, rfChl: number): Promise<void> {
  const token = await getToken()

  const res = await fetch(`${BASE}/v2/device/thing/status`, {
    method: "POST",
    headers: baseHeaders(token),
    body: JSON.stringify({
      type: 1,
      id: deviceId,
      params: { cmd: "transmit", rfChl },
    }),
  })

  const data = await res.json()
  if (data.error !== 0) throw new Error(`Transmit failed: ${data.msg ?? data.error}`)
}
