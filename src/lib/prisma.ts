import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { neonConfig } from "@neondatabase/serverless"

// Local development against a plain Postgres.
//
// The Neon driver speaks the Postgres protocol inside a WebSocket, so without
// this there is no way to run the app without a Neon account — which is why it
// had never actually been run locally. Rather than swap in a different client
// for local dev (and stop exercising the one production uses), the driver is
// pointed at a small bridge that unwraps the frames; see .ci/dev-wsproxy.mjs
// and docs/local-dev.md.
//
// Guarded by an env var that only ever appears in .env.local. If it were set
// anywhere real the connection would simply fail to reach 127.0.0.1 — loudly,
// and without touching data.
if (process.env.LOCAL_PG === "1") {
  neonConfig.wsProxy = (host: string, port: number | string) =>
    `127.0.0.1:${process.env.WSPROXY_PORT ?? 5434}/v1?address=${host}:${port}`
  neonConfig.useSecureWebSocket = false
  neonConfig.pipelineTLS = false
  neonConfig.pipelineConnect = false
  // Node 22 has a global WebSocket, so no node-only import reaches any bundle.
  neonConfig.webSocketConstructor = globalThis.WebSocket as never
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL!
  const adapter = new PrismaNeon({ connectionString })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
