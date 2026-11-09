// WebSocket-to-TCP bridge, so the app's real Neon adapter can reach a plain
// local Postgres.
//
// The app connects through @prisma/adapter-neon, which speaks the Postgres wire
// protocol inside a WebSocket rather than over a socket. That is a hard
// requirement of Neon's serverless driver and there is nothing to swap out —
// so instead of giving local dev a different database client (which would mean
// local runs no longer exercise the code production uses), this unwraps the
// frames and forwards the bytes to a normal Postgres on 5433.
//
//   node .ci/dev-wsproxy.mjs
//
// See docs/local-dev.md. The self-hosted local database
// (docker/selfhost/compose.localdb.yml) runs the same bridge as a container,
// with WSPROXY_BIND=0.0.0.0 so the app container can reach it; it is still not
// published outside the compose network.
import { WebSocketServer } from "ws"
import net from "node:net"

const PORT = Number(process.env.WSPROXY_PORT ?? 5434)
const BIND = process.env.WSPROXY_BIND ?? "127.0.0.1"
const wss = new WebSocketServer({ port: PORT, host: BIND })

wss.on("connection", (ws, req) => {
  // The driver names its target in the query string; honouring it rather than
  // hardcoding one keeps this usable for a second database.
  const addr = new URL(req.url, "http://x").searchParams.get("address") ?? "127.0.0.1:5433"
  const [host, port] = addr.split(":")
  const tcp = net.connect({ host, port: Number(port) })

  // Frames can arrive before the socket finishes connecting; dropping them
  // loses the startup packet and the connection hangs with no error.
  const queued = []
  let open = false
  tcp.on("connect", () => { open = true; for (const d of queued.splice(0)) tcp.write(d) })

  ws.on("message", d => (open ? tcp.write(d) : queued.push(d)))
  tcp.on("data", d => { if (ws.readyState === 1) ws.send(d) })

  const close = () => { try { ws.close() } catch { /* already gone */ } ; tcp.destroy() }
  tcp.on("error", close)
  tcp.on("close", close)
  ws.on("error", close)
  ws.on("close", () => tcp.destroy())
})

console.log(`ws->tcp proxy on ws://${BIND}:${PORT}`)
