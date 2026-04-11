// Tuya OpenAPI v2 — used by Smart Life, Tuya Smart, and many OEM apps
// Docs: https://developer.tuya.com/en/docs/cloud

import { createHmac, createHash } from "crypto"

const REGION_BASE: Record<string, string> = {
  eu: "https://openapi.tuyaeu.com",
  us: "https://openapi.tuyaus.com",
  cn: "https://openapi.tuyacn.com",
  in: "https://openapi.tuyain.com",
}

const CLIENT_ID     = process.env.TUYA_CLIENT_ID!
const CLIENT_SECRET = process.env.TUYA_CLIENT_SECRET!
const REGION        = process.env.TUYA_REGION ?? "eu"
const BASE          = REGION_BASE[REGION] ?? REGION_BASE.eu

let cachedToken: { access_token: string; expiresAt: number } | null = null

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

function hmac(secret: string, str: string) {
  return createHmac("sha256", secret).update(str).digest("hex").toUpperCase()
}

function sign(token: string, method: string, path: string, body = "") {
  const t = Date.now().toString()
  const nonce = ""
  const contentHash = sha256(body)
  const stringToSign = [method, contentHash, "", path].join("\n")
  const str = CLIENT_ID + token + t + nonce + stringToSign
  return { sign: hmac(CLIENT_SECRET, str), t, nonce }
}

function headers(token: string, method: string, path: string, body = "") {
  const { sign: s, t, nonce } = sign(token, method, path, body)
  return {
    "client_id": CLIENT_ID,
    "sign": s,
    "t": t,
    "sign_method": "HMAC-SHA256",
    "nonce": nonce,
    "access_token": token,
    "Content-Type": "application/json",
  }
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.access_token

  const path = "/v1.0/token?grant_type=1"
  const t    = Date.now().toString()
  const stringToSign = ["GET", sha256(""), "", path].join("\n")
  const str  = CLIENT_ID + t + "" + stringToSign
  const s    = hmac(CLIENT_SECRET, str)

  const res = await fetch(`${BASE}${path}`, {
    headers: {
      client_id: CLIENT_ID,
      sign: s,
      t,
      sign_method: "HMAC-SHA256",
      nonce: "",
    },
    cache: "no-store",
  })

  const data = await res.json()
  if (!data.success) throw new Error(`Tuya auth failed: ${data.msg ?? JSON.stringify(data)}`)

  cachedToken = {
    access_token: data.result.access_token,
    expiresAt: Date.now() + data.result.expire_time * 1000,
  }
  return cachedToken.access_token
}

async function tuyaGet(path: string) {
  const token = await getToken()
  const res = await fetch(`${BASE}${path}`, {
    headers: headers(token, "GET", path),
    cache: "no-store",
  })
  const data = await res.json()
  if (!data.success) throw new Error(`Tuya GET ${path} failed: ${data.msg}`)
  return data.result
}

async function tuyaPost(path: string, body: unknown) {
  const token = await getToken()
  const bodyStr = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: headers(token, "POST", path, bodyStr),
    body: bodyStr,
  })
  const data = await res.json()
  if (!data.success) throw new Error(`Tuya POST ${path} failed: ${data.msg}`)
  return data.result
}

export interface TuyaDevice {
  id: string
  name: string
  category: string   // "cz" = socket, "dj" = light, "sweep_robot" = vacuum, etc.
  online: boolean
  status: { code: string; value: boolean | number | string }[]
}

export async function getTuyaDevices(): Promise<TuyaDevice[]> {
  // Get all devices linked to this cloud project
  const result = await tuyaGet("/v2.0/cloud/thing/device/list-by-page?page_size=50&page_no=1")
  return (result?.devices ?? result?.list ?? []) as TuyaDevice[]
}

export async function getTuyaDeviceStatus(deviceId: string) {
  return tuyaGet(`/v2.0/cloud/thing/${deviceId}/shadow/properties`) as Promise<{ properties: { code: string; value: unknown }[] }>
}

export async function controlTuya(deviceId: string, commands: { code: string; value: unknown }[]) {
  await tuyaPost(`/v2.0/cloud/thing/${deviceId}/shadow/properties/issue`, {
    properties: Object.fromEntries(commands.map((c) => [c.code, c.value])),
  })
}
