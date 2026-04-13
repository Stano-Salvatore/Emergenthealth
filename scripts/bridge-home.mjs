import https from "node:https"
import http from "node:http"

const HOST = "eugrih.gree.com"
const PORT = Number(process.env.PORT ?? 3001)

// eugrih.gree.com does NOT use the /apiv2 path prefix —
// strip it before forwarding so requests become e.g. /account/login
function greeePath(url) {
  return url.replace(/^\/apiv2/, "") || "/"
}

http.createServer((req, res) => {
  let body = ""
  req.on("data", c => (body += c))
  req.on("end", () => {
    const path = greeePath(req.url)
    const ts = new Date().toISOString().slice(11, 19)
    console.log(`[${ts}] ${req.method} ${req.url} → ${HOST}${path}`)
    const buf = Buffer.from(body)
    const r = https.request(
      {
        hostname: HOST, port: 443, path, method: req.method,
        headers: { "Content-Type": "application/json", "Content-Length": buf.length },
      },
      s => {
        let d = ""
        s.on("data", c => (d += c))
        s.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(d)
          console.log(`  => ${d.slice(0, 120)}`)
        })
      }
    )
    r.on("error", e => {
      res.writeHead(502)
      res.end(JSON.stringify({ status: 0, msg: e.message }))
      console.log(`  ✗ ${e.message}`)
    })
    r.setTimeout(8000, () => r.destroy(new Error("timeout")))
    if (buf.length) r.write(buf)
    r.end()
  })
}).listen(PORT, () => console.log("Bridge running on port " + PORT))
