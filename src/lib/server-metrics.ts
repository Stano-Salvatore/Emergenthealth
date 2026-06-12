import http from "node:http"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import os from "node:os"
import { readFile, readdir } from "node:fs/promises"

const execFileAsync = promisify(execFile)

// ── Rolling history (module-level — persists in next start, reset per deploy) ─

const HISTORY_LEN = 30
let prevCpu: { idle: number; total: number } | null = null
export const cpuHistory: number[] = new Array(HISTORY_LEN).fill(0)
export const ramHistory: number[] = new Array(HISTORY_LEN).fill(0)
let collectionStarted = false

export function ensureHistoryCollection() {
  if (collectionStarted) return
  collectionStarted = true
  // baseline reading so first real sample has a diff
  readCpuRaw().then(raw => { prevCpu = raw }).catch(() => {})
  setInterval(async () => {
    const cpu = await getCpuUsage()
    cpuHistory.push(cpu); if (cpuHistory.length > HISTORY_LEN) cpuHistory.shift()
    const used = os.totalmem() - os.freemem()
    ramHistory.push(Math.round((used / os.totalmem()) * 100))
    if (ramHistory.length > HISTORY_LEN) ramHistory.shift()
  }, 60_000)
}

// ── CPU ───────────────────────────────────────────────────────────────────────

async function readCpuRaw() {
  const data = await readFile("/proc/stat", "utf8")
  const parts = data.split("\n")[0].trim().split(/\s+/).slice(1).map(Number)
  const idle  = parts[3] + (parts[4] ?? 0)
  const total = parts.reduce((a, b) => a + b, 0)
  return { idle, total }
}

export async function getCpuUsage(): Promise<number> {
  try {
    const curr = await readCpuRaw()
    if (!prevCpu) { prevCpu = curr; return 0 }
    const dIdle  = curr.idle  - prevCpu.idle
    const dTotal = curr.total - prevCpu.total
    prevCpu = curr
    return dTotal > 0 ? Math.max(0, Math.round(((dTotal - dIdle) / dTotal) * 100)) : 0
  } catch { return 0 }
}

// ── RAM ───────────────────────────────────────────────────────────────────────

export function getRam() {
  const total = os.totalmem()
  const free  = os.freemem()
  const used  = total - free
  return { total, free, used, pct: Math.round((used / total) * 100), history: [...ramHistory] }
}

// ── Temperature ───────────────────────────────────────────────────────────────

export async function getTemps(): Promise<{ zone: string; temp: number }[]> {
  try {
    const zones = await readdir("/sys/class/thermal")
    const results: { zone: string; temp: number }[] = []
    for (const zone of zones) {
      if (!zone.startsWith("thermal_zone")) continue
      try {
        const [rawTemp, rawType] = await Promise.all([
          readFile(`/sys/class/thermal/${zone}/temp`, "utf8"),
          readFile(`/sys/class/thermal/${zone}/type`, "utf8"),
        ])
        const temp = parseInt(rawTemp.trim()) / 1000
        if (temp > 0 && temp < 120)
          results.push({ zone: rawType.trim(), temp: Math.round(temp * 10) / 10 })
      } catch {}
    }
    return results
  } catch { return [] }
}

// ── Disk ──────────────────────────────────────────────────────────────────────

const INTERESTING_MOUNTS = new Set(["/", "/data", "/backup", "/var", "/home", "/mnt/data"])

export async function getDisk() {
  try {
    const { stdout } = await execFileAsync("df", ["-B1", "--output=target,size,used,avail,pcent"])
    return stdout.trim().split("\n").slice(1)
      .map(line => {
        const [mount, size, used, avail, pct] = line.trim().split(/\s+/)
        return { mount, size: +size, used: +used, avail: +avail, usedPct: parseInt(pct) }
      })
      .filter(d => INTERESTING_MOUNTS.has(d.mount))
  } catch { return [] }
}

// ── Docker via unix socket ────────────────────────────────────────────────────

function dockerRequest(
  path: string,
  method = "GET",
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null
    const req = http.request(
      {
        socketPath: "/var/run/docker.sock",
        path,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let buf = ""
        res.on("data", c => (buf += c))
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 200, data: JSON.parse(buf) }) }
          catch   { resolve({ status: res.statusCode ?? 200, data: buf }) }
        })
      }
    )
    req.on("error", reject)
    if (payload) req.write(payload)
    req.end()
  })
}

export async function listContainers() {
  const { data } = await dockerRequest("/containers/json?all=1")
  return data as unknown[]
}

export async function containerAction(id: string, action: "start" | "stop" | "restart") {
  const { status } = await dockerRequest(
    `/containers/${encodeURIComponent(id)}/${action}`,
    "POST"
  )
  return { ok: status < 300, status }
}

// ── Ping ──────────────────────────────────────────────────────────────────────

export async function pingUrl(url: string) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: "no-store" })
    await res.body?.cancel()
    return { ok: true, ms: Date.now() - t0, status: res.status }
  } catch {
    return { ok: false, ms: Date.now() - t0 }
  }
}

export async function pingServices(services: Record<string, string>) {
  const pairs = await Promise.all(
    Object.entries(services).map(async ([name, url]) => [name, await pingUrl(url)] as const)
  )
  return Object.fromEntries(pairs)
}
