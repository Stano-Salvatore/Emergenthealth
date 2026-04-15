#!/usr/bin/env node
// AC Bridge — local LAN UDP ↔ EWPE cloud API emulation
//
// Runs in a Docker container with --network=host so it can reach the AC
// directly via UDP on the same LAN. Exposes an HTTP server that speaks
// the same JSON API that Vercel's ewpe-smart.ts expects.
//
// SETUP:
//   cd docker/ac-bridge
//   GREE_MAC=xxxxxxxxxxxx GREE_IP=192.168.x.x docker compose up -d
//   npx cloudflared tunnel --url http://localhost:8088
//   → set EWPE_API_URL=https://<tunnel>.trycloudflare.com/apiv2 in Vercel

import http from "node:http"
import dgram from "node:dgram"
import crypto from "node:crypto"

const PORT    = Number(process.env.PORT     ?? 8088)
const AC_PORT = 7000
const MAC     = (process.env.GREE_MAC ?? "9424b8badd3b").toLowerCase().replace(/:/g, "")
const NAME    = process.env.GREE_NAME ?? "Sinclair AC"
const SCAN_NET = process.env.GREE_SCAN_NET ?? "192.168.100"   // e.g. "10.0.1"
const GKEY    = "a3K8Bx%2r8Y7#xDh"

// ── Device key — obtained from EWPE Smart app, no LAN bind needed ─────────────
let devKey = process.env.GREE_DEV_KEY ?? "60230602AA85C1BF"

// ── Dynamic IP discovery ────────────────────────────────────────────────────
// Prefer env override; otherwise scan the LAN to find the AC's current IP
let IP = process.env.GREE_IP ?? null
let ipDiscoveredAt = 0
const IP_TTL = 5 * 60 * 1000  // re-discover after 5 minutes

async function discoverIp() {
  if (IP && Date.now() - ipDiscoveredAt < IP_TTL) return IP
  console.log(`[discover] Scanning ${SCAN_NET}.1-254 for MAC ${MAC}…`)
  const pkt = Buffer.from(JSON.stringify({ t: "scan" }))
  return new Promise((resolve) => {
    const s = dgram.createSocket({ type: "udp4", reuseAddr: true })
    let found = null
    s.bind(0, () => {
      s.on("message", (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString())
          const mac = (data.cid ?? data.mac ?? "").toLowerCase().replace(/[^0-9a-f]/g, "")
          if (mac === MAC) {
            found = rinfo.address
            console.log(`[discover] Found AC at ${found}`)
            clearTimeout(timer)
            s.close()
            IP = found
            ipDiscoveredAt = Date.now()
            resolve(found)
          }
        } catch {}
      })
      for (let i = 1; i <= 254; i++) s.send(pkt, AC_PORT, `${SCAN_NET}.${i}`)
    })
    const timer = setTimeout(() => {
      try { s.close() } catch {}
      if (!found) {
        console.warn(`[discover] AC not found on ${SCAN_NET}.0/24`)
        // Keep using last known IP if we have one
        resolve(IP)
      }
    }, 5000)
  })
}

// ── Crypto ────────────────────────────────────────────────────────────────────

function enc(obj, key) {
  const k = Buffer.from(typeof key === "string" ? key.slice(0, 16) : key.slice(0, 16))
  const c = crypto.createCipheriv("aes-128-ecb", k, null)
  c.setAutoPadding(true)
  return Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]).toString("base64")
}

function dec(b64, key) {
  const k = Buffer.from(typeof key === "string" ? key.slice(0, 16) : key.slice(0, 16))
  const d = crypto.createDecipheriv("aes-128-ecb", k, null)
  d.setAutoPadding(true)
  return JSON.parse(Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]).toString())
}

// ── UDP send/receive ───────────────────────────────────────────────────────────

function udp(payload, ms = 4000) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket("udp4")
    let done = false
    const end = fn => { if (!done) { done = true; try { s.close() } catch {} fn() } }
    s.on("message", m => end(() => { try { resolve(JSON.parse(m.toString())) } catch (e) { reject(e) } }))
    s.on("error",   e => end(() => reject(e)))
    setTimeout(()  => end(() => reject(new Error("UDP timeout"))), ms)
    // IP may be null if AC not yet discovered — caller ensures discoverIp() ran first
    s.send(Buffer.from(JSON.stringify(payload)), AC_PORT, IP ?? "192.168.100.49", e => { if (e) end(() => reject(e)) })
  })
}

// ── AC protocol ───────────────────────────────────────────────────────────────

async function bind() {
  console.log(`Binding to ${IP}:${AC_PORT} (MAC ${MAC})…`)

  // Step 1: scan to wake the device (some firmware requires this before bind)
  try {
    await udp({ t: "scan" }, 3000)
    console.log("  scan ok")
  } catch { /* ignore — carry on to bind even if scan times out */ }

  // Step 2: send bind
  const r = await udp({
    cid: "app", i: 1,
    pack: enc({ mac: MAC, t: "bind", uid: 0 }, GKEY),
    t: "pack", tcid: MAC, uid: 0,
  }, 6000)

  const result = dec(r.pack, GKEY)
  if (result.t !== "bindok") throw new Error("bind failed: " + JSON.stringify(result))
  devKey = result.key
  console.log("  ✓ Bound, devKey:", devKey)
  return devKey
}

const STATUS_COLS = [
  "Pow","Mod","SetTem","TemSen","WdSpd","Air","Blo","Health",
  "SwhSlp","Tur","StHt","TemUn","HeatCoolType","TemRec",
  "SwingLfRig","SwUpDn","Quiet","SvSt","AllErr",
]

async function getStatus() {
  await discoverIp()
  if (!devKey) await bind()
  const r = await udp({
    cid: "app", i: 0,
    pack: enc({ cols: STATUS_COLS, mac: MAC, t: "status" }, devKey),
    t: "pack", tcid: MAC, uid: 0,
  })
  const result = dec(r.pack, devKey)
  const attrs = {}
  ;(result.cols ?? STATUS_COLS).forEach((col, i) => { attrs[col] = result.dat?.[i] ?? 0 })
  return attrs
}

async function setControl(attrs) {
  await discoverIp()
  if (!devKey) await bind()
  const keys = Object.keys(attrs)
  const vals = Object.values(attrs)
  const r = await udp({
    cid: "app", i: 0,
    pack: enc({ opt: keys, p: vals, t: "cmd", uid: 0 }, devKey),
    t: "pack", tcid: MAC, uid: 0,
  })
  return dec(r.pack, devKey)
}

// ── HTTP routes (EWPE cloud API format) ───────────────────────────────────────

const ROUTES = {
  "POST /apiv2/account/login": async () => ({
    status: 1, data: { uid: "local", token: "local" },
  }),

  "POST /apiv2/binding/getUserDeviceList": async () => ({
    status: 1,
    data: {
      devices: [{ deviceId: MAC, deviceName: NAME, mac: MAC, online: true }],
    },
  }),

  "POST /apiv2/aircon/devstatus": async () => {
    const attrs = await getStatus()
    return { status: 1, data: { attrs } }
  },

  "POST /apiv2/aircon/devcontrol": async (p) => {
    await setControl(p.attrs ?? {})
    return { status: 1 }
  },

  "GET /health": async () => ({ ok: true, ip: IP, mac: MAC, devKey: devKey ? "set" : "unset" }),
}

// ── HTTP server ───────────────────────────────────────────────────────────────

http.createServer((req, res) => {
  let body = ""
  req.on("data", c => body += c)
  req.on("end", async () => {
    // Normalise: ensure /apiv2 prefix so ROUTES always match regardless of EWPE_API_URL format
    const normUrl = req.url.startsWith("/apiv2") ? req.url : `/apiv2${req.url}`
    const route = `${req.method} ${normUrl}`
    const ts    = new Date().toISOString().slice(11, 19)
    console.log(`[${ts}] ${route}`)

    const handler = ROUTES[route]
    if (!handler) {
      res.writeHead(404)
      res.end(JSON.stringify({ status: 0, msg: "not found" }))
      return
    }

    let payload = {}
    try { payload = JSON.parse(body) } catch {}

    try {
      const result = await handler(payload)
      console.log(`  → ${result.status === 1 ? "OK" : "ERR " + (result.msg ?? "")}`)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (e) {
      console.error(`  → FAIL: ${e.message}`)
      // devKey is hardcoded — do not clear it on timeout
      res.writeHead(500)
      res.end(JSON.stringify({ status: 0, msg: e.message }))
    }
  })
}).listen(PORT, "0.0.0.0", () => {
  console.log("")
  console.log(`  AC Bridge running on http://localhost:${PORT}`)
  console.log(`  AC: ${NAME}  MAC=${MAC}`)
  console.log(`  Scan net: ${SCAN_NET}.0/24  (override: GREE_IP=x.x.x.x)`)
  console.log(`  devKey: ${devKey}  (pre-set — no LAN bind required)`)
  console.log("")
  console.log("  Next: expose via Cloudflare Tunnel:")
  console.log("    npx cloudflared tunnel --url http://localhost:" + PORT)
  console.log("  Then set in Vercel:")
  console.log("    EWPE_API_URL = https://<tunnel>.trycloudflare.com/apiv2")
  console.log("")
})
