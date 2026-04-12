#!/usr/bin/env node
// EWPE Smart / Gree cloud API — local bridge proxy
//
// The Gree cloud API blocks requests from datacenters (like Vercel).
// Run this on your home PC where the Gree servers are reachable,
// then expose it via Cloudflare Tunnel so Vercel can call it.
//
// SETUP (one-time):
//   1. Install Node.js 18+ on your PC: https://nodejs.org
//   2. Run:  node scripts/ewpe-bridge.mjs
//   3. In a second terminal run:  npx cloudflared tunnel --url http://localhost:3001
//      Cloudflare will print a URL like: https://abc-def-ghi.trycloudflare.com
//   4. In Vercel → Settings → Environment Variables add:
//        EWPE_API_URL = https://abc-def-ghi.trycloudflare.com/apiv2
//   5. Redeploy on Vercel
//
// The bridge has zero npm dependencies and uses only Node.js built-ins.
// Keep the terminal window open while you want AC control to work.

import http from "http"
import https from "https"

const PORT = Number(process.env.PORT ?? 3001)

// Try these Gree endpoints in order — first one that responds wins
// eugrih.gree.com is the real EU endpoint (CNAME → AWS eu-central-1 Frankfurt)
const GREE_HOSTS = [
  "eugrih.gree.com",
  "euapi.gree.com",
  "openapi.gree.com",
  "account.gree.com",
]

function proxyRequest(host, path, method, body) {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body || "")
    const options = {
      hostname: host,
      port: 443,
      path,
      method: method || "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": bodyBuf.length,
      },
    }

    const req = https.request(options, (res) => {
      let data = ""
      res.on("data", (chunk) => (data += chunk))
      res.on("end", () => resolve(data))
    })

    req.on("error", reject)
    req.setTimeout(8000, () => req.destroy(new Error("timeout")))
    if (bodyBuf.length) req.write(bodyBuf)
    req.end()
  })
}

const server = http.createServer((req, res) => {
  let body = ""
  req.on("data", (chunk) => (body += chunk))
  req.on("end", async () => {
    const ts = new Date().toISOString().slice(11, 19)
    console.log(`[${ts}] ${req.method} ${req.url}`)

    for (const host of GREE_HOSTS) {
      try {
        const raw = await proxyRequest(host, req.url, req.method, body)
        let parsed
        try { parsed = JSON.parse(raw) } catch { continue }

        // Accept any response that has a 'status' field (Gree API contract)
        if ("status" in parsed) {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(raw)
          const ok = parsed.status === 1 ? "OK" : `status=${parsed.status}`
          console.log(`  ✓ ${host} → ${ok}`)
          return
        }
      } catch (e) {
        console.log(`  ✗ ${host}: ${e.message}`)
      }
    }

    res.writeHead(502)
    res.end(JSON.stringify({ status: 0, msg: "All Gree endpoints unreachable from bridge" }))
    console.log("  ✗ all hosts failed")
  })
})

server.listen(PORT, () => {
  console.log("")
  console.log("  EWPE bridge running on http://localhost:" + PORT)
  console.log("")
  console.log("  Next steps:")
  console.log("    npx cloudflared tunnel --url http://localhost:" + PORT)
  console.log("    → copy the trycloudflare.com URL it prints")
  console.log("    → add to Vercel env vars:")
  console.log("        EWPE_API_URL = https://<that-url>/apiv2")
  console.log("    → redeploy")
  console.log("")
})
