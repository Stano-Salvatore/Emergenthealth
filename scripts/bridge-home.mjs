import https from "node:https"
import http from "node:http"

// eugrih.gree.com = NOT the REST API (returns 404 for all paths, probably MQTT)
// euapi.gree.com  = the real EU REST API (blocked from datacenter but works from home)
const HOSTS = [
  "euapi.gree.com",
  "openapi.gree.com",
  "account.gree.com",
]

const PORT = Number(process.env.PORT ?? 3001)

function tryHost(host, path, method, buf) {
  return new Promise((resolve, reject) => {
    const r = https.request(
      { hostname: host, port: 443, path, method,
        headers: { "Content-Type": "application/json", "Content-Length": buf.length } },
      s => {
        let d = ""
        s.on("data", c => (d += c))
        s.on("end", () => resolve({ host, body: d, status: s.statusCode }))
      }
    )
    r.on("error", reject)
    r.setTimeout(8000, () => r.destroy(new Error("timeout")))
    if (buf.length) r.write(buf)
    r.end()
  })
}

http.createServer((req, res) => {
  let body = ""
  req.on("data", c => (body += c))
  req.on("end", async () => {
    const ts = new Date().toISOString().slice(11, 19)
    console.log(`[${ts}] ${req.method} ${req.url}`)
    const buf = Buffer.from(body)

    for (const host of HOSTS) {
      try {
        const { body: d, status } = await tryHost(host, req.url, req.method, buf)
        let parsed
        try { parsed = JSON.parse(d) } catch { continue }
        if ("status" in parsed) {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(d)
          const ok = parsed.status === 1 ? "✓" : `status=${parsed.status} msg=${parsed.msg}`
          console.log(`  [${host}] ${ok}`)
          return
        }
      } catch (e) {
        console.log(`  [${host}] ✗ ${e.message}`)
      }
    }

    res.writeHead(502)
    res.end(JSON.stringify({ status: 0, msg: "All Gree hosts unreachable" }))
    console.log("  ✗ all hosts failed")
  })
}).listen(PORT, () => {
  console.log(`Bridge on port ${PORT} — trying: ${HOSTS.join(", ")}`)
})
