#!/usr/bin/env node
// EWPE Smart / Gree cloud API — local bridge proxy
//
// The Gree cloud API blocks requests from datacenters (like Vercel).
// Run this on your home PC where the Gree servers are reachable,
// then expose it via Cloudflare Tunnel so Vercel can call it.
//
// QUICKSTART — run from the repo root:
//   ./start-bridge.sh
//
// MANUAL SETUP:
//   1. node scripts/ewpe-bridge.mjs
//   2. npx cloudflared tunnel --url http://localhost:3001
//      → Cloudflare prints: https://xxxx-xxxx.trycloudflare.com
//   3. Vercel → Settings → Environment Variables:
//        EWPE_API_URL  = https://xxxx-xxxx.trycloudflare.com/apiv2
//        EWPE_EMAIL    = your-gree-account@email.com
//        EWPE_PASSWORD = your-gree-password
//   4. Redeploy on Vercel
//
// Zero npm dependencies — uses only Node.js built-ins.

import http from "http"
import https from "https"

const PORT = Number(process.env.PORT ?? 3001)
const START_TIME = Date.now()

// Try Gree endpoints in order — first to return a valid {status:…} wins
// eugrih.gree.com is the real EU endpoint (CNAME → AWS eu-central-1 Frankfurt)
const GREE_HOSTS = [
  "eugrih.gree.com",
  "euapi.gree.com",
  "openapi.gree.com",
  "account.gree.com",
]

const stats = { requests: 0, successes: 0, errors: 0 }

function proxyRequest(host, path, method, body) {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body || "")
    const req = https.request(
      {
        hostname: host,
        port: 443,
        path,
        method: method || "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": bodyBuf.length,
        },
      },
      (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => resolve(data))
      }
    )
    req.on("error", reject)
    req.setTimeout(8000, () => req.destroy(new Error("timeout")))
    if (bodyBuf.length) req.write(bodyBuf)
    req.end()
  })
}

const server = http.createServer((req, res) => {
  // ── Health check endpoint (used by start-bridge.sh) ──────────
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(
      JSON.stringify({
        status: "ok",
        uptime: Math.floor((Date.now() - START_TIME) / 1000),
        requests: stats.requests,
        successes: stats.successes,
        errors: stats.errors,
        greeHosts: GREE_HOSTS,
      })
    )
    return
  }

  // ── Proxy all other requests to Gree ─────────────────────────
  let body = ""
  req.on("data", (chunk) => (body += chunk))
  req.on("end", async () => {
    const ts = new Date().toISOString().slice(11, 19)
    console.log(`[${ts}] ${req.method} ${req.url}`)
    stats.requests++

    for (const host of GREE_HOSTS) {
      try {
        const raw = await proxyRequest(host, req.url, req.method, body)
        let parsed
        try {
          parsed = JSON.parse(raw)
        } catch {
          continue // not JSON — try next host
        }

        // Accept any response that has a 'status' field (Gree API contract)
        if ("status" in parsed) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          })
          res.end(raw)
          const ok = parsed.status === 1 ? "✓" : `status=${parsed.status}`
          console.log(`  ${ok} ${host}`)
          stats.successes++
          return
        }
      } catch (e) {
        console.log(`  ✗ ${host}: ${e.message}`)
      }
    }

    // All hosts failed
    stats.errors++
    res.writeHead(502, { "Content-Type": "application/json" })
    res.end(
      JSON.stringify({
        status: 0,
        msg: "All Gree endpoints unreachable from bridge. Check your internet connection.",
      })
    )
    console.log("  ✗ all hosts failed")
  })
})

server.listen(PORT, () => {
  const uptime = () => `${Math.floor((Date.now() - START_TIME) / 1000)}s`
  console.log("")
  console.log("  ✅ EWPE bridge running on http://localhost:" + PORT)
  console.log("  📡 Health: http://localhost:" + PORT + "/health")
  console.log("")
  console.log("  Next steps:")
  console.log("    npx cloudflared tunnel --url http://localhost:" + PORT)
  console.log("    → copy the trycloudflare.com URL Cloudflare prints")
  console.log("    → add to Vercel env vars:")
  console.log("        EWPE_API_URL  = https://<that-url>/apiv2")
  console.log("        EWPE_EMAIL    = your-gree@email.com")
  console.log("        EWPE_PASSWORD = your-password")
  console.log("    → redeploy")
  console.log("")
})
