/**
 * Emergenthealth AC Bridge — Cloudflare Worker
 *
 * Proxies EWPE Smart / Gree cloud API requests through Cloudflare's edge
 * so Vercel (which is blocked by Gree) can reach the API.
 *
 * Cloudflare Worker IPs are not in Gree's datacenter blocklist.
 *
 * Deploy once:
 *   cd cf-worker && npx wrangler login && npx wrangler deploy
 *
 * Then set in Vercel env vars:
 *   EWPE_API_URL = https://emergenthealth-ac-bridge.<your-account>.workers.dev/apiv2
 */

// Try these Gree EU endpoints in order
const GREE_HOSTS = [
  "euapi.gree.com",
  "openapi.gree.com",
  "account.gree.com",
  "eugrih.gree.com",
]

export default {
  async fetch(request) {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === "/health" || url.pathname === "/") {
      return Response.json({ status: "ok", worker: true, hosts: GREE_HOSTS })
    }

    const path = url.pathname + url.search
    const method = request.method
    const body = method !== "GET" && method !== "HEAD"
      ? await request.arrayBuffer()
      : undefined

    const errors = []

    for (const host of GREE_HOSTS) {
      try {
        const greeUrl = `https://${host}${path}`
        const res = await fetch(greeUrl, {
          method,
          headers: { "Content-Type": "application/json" },
          body,
          // Cloudflare Workers timeout: 30s
        })

        const text = await res.text()

        // Only accept valid Gree JSON responses
        let parsed
        try { parsed = JSON.parse(text) } catch { continue }
        if (typeof parsed === "object" && "status" in parsed) {
          return new Response(text, {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Gree-Host": host,
            },
          })
        }
      } catch (e) {
        errors.push(`${host}: ${e.message}`)
      }
    }

    return Response.json(
      { status: 0, msg: "All Gree hosts unreachable", errors },
      { status: 502 }
    )
  },
}
