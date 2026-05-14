import { NextRequest } from "next/server"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import {
  getSteps,
  getCalories,
  getHeartRate,
  getSleep,
  getWeight,
  getDistance,
  getActivitySessions,
  getDailySummary,
} from "@/lib/google-fit"

// Only run in Node.js (not Edge runtime) — needed for googleapis
export const runtime = "nodejs"

async function resolveUser(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? ""

  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim()
    const key = await prisma.mcpApiKey.findUnique({ where: { token } })
    return key?.userId ?? null
  }

  // Also accept Basic auth where the password is the MCP key
  if (auth.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString()
    const password = decoded.split(":")[1]
    if (password) {
      const key = await prisma.mcpApiKey.findUnique({ where: { token: password } })
      return key?.userId ?? null
    }
  }

  return null
}

function buildMcpServer(userId: string): McpServer {
  const server = new McpServer({
    name: "google-fit",
    version: "1.0.0",
  })

  const dateRangeSchema = {
    startDate: z.string().describe("Start date in YYYY-MM-DD format"),
    endDate: z.string().describe("End date in YYYY-MM-DD format"),
  }

  server.tool(
    "get_steps",
    "Get daily step counts from Google Fit for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getSteps(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_calories",
    "Get daily calories burned from Google Fit for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getCalories(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_heart_rate",
    "Get daily average, min, and max heart rate (BPM) from Google Fit for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getHeartRate(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_sleep",
    "Get sleep sessions from Google Fit for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getSleep(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_weight",
    "Get body weight measurements (kg) from Google Fit for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getWeight(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_distance",
    "Get daily distance walked/run (meters) from Google Fit for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getDistance(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_activity_sessions",
    "Get workout and activity sessions (runs, cycling, etc.) from Google Fit for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getActivitySessions(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_daily_summary",
    "Get a full health summary (steps, calories, heart rate, distance) for a single day",
    { date: z.string().describe("Date in YYYY-MM-DD format") },
    async ({ date }) => {
      const data = await getDailySummary(userId, date)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  return server
}

async function handleMcp(req: NextRequest): Promise<Response> {
  const userId = await resolveUser(req)
  if (!userId) {
    const origin = new URL(req.url).origin
    return new Response(
      JSON.stringify({ error: "Unauthorized. Provide a Bearer token from /api/mcp/key" }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer realm="${origin}", resource_metadata="${origin}/.well-known/oauth-protected-resource", as_uri="${origin}"`,
        },
      },
    )
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — safe for serverless
  })

  const server = buildMcpServer(userId)
  await server.connect(transport)

  return transport.handleRequest(req)
}

export const GET = handleMcp
export const POST = handleMcp
export const DELETE = handleMcp
