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
} from "@/lib/oura"
import {
  getStoredToken,
  getCurrentTimer,
  getTodayEntries,
  getProjects,
  startTimer,
  stopTimer,
} from "@/lib/toggl"

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
    name: "emergenthealth",
    version: "1.0.0",
  })

  const dateRangeSchema = {
    startDate: z.string().describe("Start date in YYYY-MM-DD format"),
    endDate: z.string().describe("End date in YYYY-MM-DD format"),
  }

  server.tool(
    "get_steps",
    "Get daily step counts from Oura Ring for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getSteps(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_calories",
    "Get daily calories burned from Oura Ring for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getCalories(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_heart_rate",
    "Get daily average, min, and max heart rate (BPM) from Oura Ring for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getHeartRate(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_sleep",
    "Get sleep sessions from Oura Ring for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getSleep(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_weight",
    "Get body weight measurements (kg) from Oura Ring for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getWeight(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_distance",
    "Get daily distance walked/run (meters) from Oura Ring for a date range",
    dateRangeSchema,
    async ({ startDate, endDate }) => {
      const data = await getDistance(userId, startDate, endDate)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    "get_activity_sessions",
    "Get workout and activity sessions (runs, cycling, etc.) from Oura Ring for a date range",
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

  // ── Toggl Track tools ──────────────────────────────────────────────────────

  server.tool(
    "toggl_current_timer",
    "Get the currently running Toggl timer, or null if no timer is running",
    {},
    async () => {
      const stored = await getStoredToken(userId)
      if (!stored) return { content: [{ type: "text", text: "Toggl not connected. Add your API token in the app." }] }
      const current = await getCurrentTimer(stored.apiToken)
      if (!current) return { content: [{ type: "text", text: "No timer is currently running." }] }
      const elapsedSec = Math.floor((Date.now() - new Date(current.start).getTime()) / 1000)
      const h = Math.floor(elapsedSec / 3600), m = Math.floor((elapsedSec % 3600) / 60), s = elapsedSec % 60
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: current.id,
            description: current.description ?? "(no description)",
            project_id: current.project_id,
            started_at: current.start,
            elapsed: `${h}h ${m}m ${s}s`,
            elapsed_seconds: elapsedSec,
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    "toggl_start_timer",
    "Start a new Toggl time entry. Use this when the user says they're starting work, a task, or a session.",
    {
      description: z.string().describe("What you are working on, e.g. 'coding', 'reading', 'deep work'"),
      project_name: z.string().optional().describe("Optional project name to match against existing Toggl projects"),
    },
    async ({ description, project_name }) => {
      const stored = await getStoredToken(userId)
      if (!stored?.workspaceId) return { content: [{ type: "text", text: "Toggl not connected." }] }
      let projectId: number | null = null
      if (project_name) {
        const projects = await getProjects(stored.apiToken, stored.workspaceId)
        const match = projects.find(p => p.name.toLowerCase().includes(project_name.toLowerCase()))
        projectId = match?.id ?? null
      }
      const entry = await startTimer(stored.apiToken, stored.workspaceId, description, projectId)
      return {
        content: [{
          type: "text",
          text: `Timer started: "${entry.description}"${projectId ? ` (project matched)` : ""}. Timer ID: ${entry.id}`,
        }],
      }
    },
  )

  server.tool(
    "toggl_stop_timer",
    "Stop the currently running Toggl timer",
    {},
    async () => {
      const stored = await getStoredToken(userId)
      if (!stored?.workspaceId) return { content: [{ type: "text", text: "Toggl not connected." }] }
      const current = await getCurrentTimer(stored.apiToken)
      if (!current) return { content: [{ type: "text", text: "No timer is running." }] }
      const stopped = await stopTimer(stored.apiToken, stored.workspaceId, current.id)
      return {
        content: [{
          type: "text",
          text: `Timer stopped: "${stopped.description}". Duration: ${stopped.duration}s`,
        }],
      }
    },
  )

  server.tool(
    "toggl_today_entries",
    "Get all time entries logged in Toggl today, with durations and project info",
    {},
    async () => {
      const stored = await getStoredToken(userId)
      if (!stored) return { content: [{ type: "text", text: "Toggl not connected." }] }
      const [entries, projects] = await Promise.all([
        getTodayEntries(stored.apiToken),
        stored.workspaceId ? getProjects(stored.apiToken, stored.workspaceId) : Promise.resolve([]),
      ])
      const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]))
      const completed = entries.filter(e => e.duration > 0)
      const totalSec = completed.reduce((s, e) => s + e.duration, 0)
      const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60)
      const result = {
        total_today: `${h}h ${m}m`,
        total_seconds: totalSec,
        entries: completed.map(e => ({
          description: e.description ?? "(no description)",
          project: e.project_id ? (projectMap[e.project_id] ?? `project_${e.project_id}`) : null,
          duration_seconds: e.duration,
          duration: `${Math.floor(e.duration / 60)}m`,
          started: e.start,
        })),
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    "toggl_projects",
    "List all active Toggl projects available to the user",
    {},
    async () => {
      const stored = await getStoredToken(userId)
      if (!stored?.workspaceId) return { content: [{ type: "text", text: "Toggl not connected." }] }
      const projects = await getProjects(stored.apiToken, stored.workspaceId)
      return {
        content: [{
          type: "text",
          text: JSON.stringify(projects.map(p => ({ id: p.id, name: p.name, color: p.color })), null, 2),
        }],
      }
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
