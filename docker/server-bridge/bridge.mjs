#!/usr/bin/env node
// Server Bridge — system metrics + Docker management for Gemmi PWA
//
// Runs on the Lenovo server inside Docker with /var/run/docker.sock mounted.
// Exposes an HTTP API that the Gemmi Next.js API routes call via a tunnel.
//
// SETUP:
//   cd docker/server-bridge
//   BRIDGE_TOKEN=<secret> docker compose up -d
//   npx cloudflared tunnel --url http://localhost:7070
//   → set SERVER_BRIDGE_URL=https://<tunnel>.trycloudflare.com in Vercel
//   → set SERVER_BRIDGE_TOKEN=<secret> in Vercel

import http from "node:http"
import https from "node:https"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import os from "node:os"
import fs from "node:fs/promises"

const execFileAsync = promisify(execFile)
const PORT  = Number(process.env.PORT ?? 7070)
const TOKEN = process.env.BRIDGE_TOKEN ?? ""

// ── Docker via unix socket ──────────────────────────────────────────────────
function dockerAPI(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const opts = {
      socketPath: "/var/run/docker.sock",
      path,
      method,
      headers: payload
        ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
        : {},
    }
    const req = http.request(opts, (res) => {
      let data = ""
      res.on("data", c => (data += c))
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: data }) }
      })
    })
    req.on("error", reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// ── CPU usage from /proc/stat ───────────────────────────────────────────────
let prevCpu = null
async function getCpuUsage() {
  try {
    const data = await fs.readFile("/proc/stat", "utf8")
    const line = data.split("\n")[0]
    const parts = line.trim().split(/\s+/).slice(1).map(Number)
    const idle = parts[3] + (parts[4] ?? 0)
    const total = parts.reduce((a, b) => a + b, 0)
    if (!prevCpu) { prevCpu = { idle, total }; return 0 }
    const dIdle  = idle  - prevCpu.idle
    const dTotal = total - prevCpu.total
    prevCpu = { idle, total }
    return dTotal > 0 ? Math.max(0, Math.round(((dTotal - dIdle) / dTotal) * 100)) : 0
  } catch { return 0 }
}

// ── Temperature from /sys/class/thermal ────────────────────────────────────
async function getTemps() {
  try {
    const zones = await fs.readdir("/sys/class/thermal")
    const temps = []
    for (const zone of zones) {
      if (!zone.startsWith("thermal_zone")) continue
      try {
        const [rawTemp, rawType] = await Promise.all([
          fs.readFile(`/sys/class/thermal/${zone}/temp`, "utf8"),
          fs.readFile(`/sys/class/thermal/${zone}/type`, "utf8"),
        ])
        const temp = parseInt(rawTemp.trim()) / 1000
        if (temp > 0 && temp < 120)
          temps.push({ zone: rawType.trim(), temp: Math.round(temp * 10) / 10 })
      } catch {}
    }
    return temps
  } catch { return [] }
}

// ── Disk usage via df ────────────────────────────────────────────────────────
const INTERESTING_MOUNTS = new Set(["/", "/data", "/backup", "/var", "/home", "/mnt/data"])

async function getDisk() {
  try {
    const { stdout } = await execFileAsync("df", ["-B1", "--output=target,size,used,avail,pcent"])
    return stdout
      .trim()
      .split("\n")
      .slice(1)
      .map(line => {
        const [mount, size, used, avail, pct] = line.trim().split(/\s+/)
        return { mount, size: +size, used: +used, avail: +avail, usedPct: parseInt(pct) }
      })
      .filter(d => INTERESTING_MOUNTS.has(d.mount))
  } catch { return [] }
}

// ── Ping a URL ───────────────────────────────────────────────────────────────
function pingUrl(url) {
  return new Promise(resolve => {
    const t0  = Date.now()
    const lib = url.startsWith("https") ? https : http
    try {
      const req = lib.get(url, { timeout: 5000 }, res => {
        res.resume()
        resolve({ ok: true, ms: Date.now() - t0, status: res.statusCode })
      })
      req.on("error",   () => resolve({ ok: false, ms: Date.now() - t0 }))
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, ms: 5000 }) })
    } catch { resolve({ ok: false, ms: Date.now() - t0 }) }
  })
}

// ── Rolling history (one sample per minute) ─────────────────────────────────
const HISTORY_LEN = 30
const cpuHistory = new Array(HISTORY_LEN).fill(0)
const ramHistory = new Array(HISTORY_LEN).fill(0)

async function updateHistory() {
  const cpu = await getCpuUsage()
  cpuHistory.push(cpu); if (cpuHistory.length > HISTORY_LEN) cpuHistory.shift()

  const usedRam = os.totalmem() - os.freemem()
  const ramPct  = Math.round((usedRam / os.totalmem()) * 100)
  ramHistory.push(ramPct); if (ramHistory.length > HISTORY_LEN) ramHistory.shift()
}

// Warm-up first reading (establishes prevCpu baseline)
getCpuUsage().then(() => {
  setTimeout(updateHistory, 2000)
  setInterval(updateHistory, 60_000)
})

// ── Node registration (phones push here) ────────────────────────────────────
const nodes = new Map()

// ── Router ───────────────────────────────────────────────────────────────────
const ROUTES = [
  [/^GET \/health$/,               handleHealth],
  [/^GET \/system$/,               handleSystem],
  [/^GET \/docker$/,               handleDockerList],
  [/^POST \/docker\/(.+)\/(start|stop|restart)$/, handleDockerAction],
  [/^GET \/ping$/,                 handlePing],
  [/^POST \/node\/report$/,        handleNodeReport],
  [/^GET \/nodes$/,                handleNodes],
]

async function handleHealth(req, res) {
  json(res, { ok: true, ts: Date.now(), hostname: os.hostname() })
}

async function handleSystem(req, res) {
  const [cpu, temps, disk] = await Promise.all([getCpuUsage(), getTemps(), getDisk()])
  const total = os.totalmem()
  const used  = total - os.freemem()
  json(res, {
    hostname: os.hostname(),
    cpu:  { usage: cpu, history: [...cpuHistory] },
    ram:  { total, used, free: total - used, pct: Math.round((used / total) * 100), history: [...ramHistory] },
    temps,
    disk,
    uptime:  os.uptime(),
    loadAvg: os.loadavg(),
  })
}

async function handleDockerList(req, res) {
  const result = await dockerAPI("/containers/json?all=1")
  json(res, result.body)
}

async function handleDockerAction(req, res, [, id, action]) {
  const result = await dockerAPI(`/containers/${encodeURIComponent(id)}/${action}`, "POST")
  json(res, { ok: result.status < 300, httpStatus: result.status })
}

async function handlePing(req, res) {
  let services = {}
  try { services = JSON.parse(process.env.PING_SERVICES ?? "{}") } catch {}
  const results = {}
  await Promise.all(
    Object.entries(services).map(async ([name, url]) => {
      results[name] = await pingUrl(url)
    })
  )
  json(res, results)
}

async function handleNodeReport(req, res) {
  const body = await readBody(req)
  if (body?.id) {
    nodes.set(body.id, { ...body, seenAt: Date.now() })
  }
  json(res, { ok: true })
}

async function handleNodes(req, res) {
  const now = Date.now()
  const list = [...nodes.values()].map(n => ({
    ...n,
    online: now - n.seenAt < 3 * 60 * 1000,
  }))
  json(res, list)
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", c => (data += c))
    req.on("end", () => { try { resolve(JSON.parse(data)) } catch { resolve({}) } })
    req.on("error", reject)
  })
}

// ── Server ───────────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type" })
    res.end(); return
  }

  if (TOKEN && req.headers["authorization"] !== `Bearer ${TOKEN}`) {
    json(res, { error: "Unauthorized" }, 401); return
  }

  const key = `${req.method} ${new URL(req.url, "http://x").pathname}`
  for (const [pattern, handler] of ROUTES) {
    const m = key.match(pattern)
    if (m) {
      try { await handler(req, res, m) } catch (e) { json(res, { error: String(e) }, 500) }
      return
    }
  }
  json(res, { error: "Not found" }, 404)
}).listen(PORT, () => console.log(`[server-bridge] Listening on :${PORT}`))
