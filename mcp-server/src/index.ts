#!/usr/bin/env node
/**
 * Smartwatch Health MCP Server
 *
 * Modes:
 *   stdio  (default)  — pipe to Claude Desktop / Claude Code
 *   http   (--http)   — SSE server for Claude.ai web connector
 *
 * Android push webhook (HTTP mode only):
 *   POST /push  { "api_key": "…", "user_id": "…", "date": "YYYY-MM-DD", … }
 */

import "dotenv/config"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import express, { type Request, type Response } from "express"
import { createMcpServer } from "./server.js"
import * as db from "./db.js"

const httpMode = process.argv.includes("--http")

if (httpMode) {
  startHttpServer()
} else {
  startStdioServer()
}

// ── stdio mode ───────────────────────────────────────────────────────────────

async function startStdioServer() {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdio: no console.log (would corrupt the JSON-RPC stream)
}

// ── HTTP / SSE mode ──────────────────────────────────────────────────────────

async function startHttpServer() {
  const app = express()
  app.use(express.json())

  const PORT = Number(process.env.PORT ?? 3100)

  // Each SSE connection gets its own MCP server instance so sessions are isolated.
  const transports: Record<string, SSEServerTransport> = {}

  // Claude.ai connector endpoint — GET /sse establishes the stream
  app.get("/sse", async (_req: Request, res: Response) => {
    const transport = new SSEServerTransport("/messages", res)
    const server = createMcpServer()

    transports[transport.sessionId] = transport
    res.on("close", () => delete transports[transport.sessionId])

    await server.connect(transport)
  })

  // Claude.ai connector endpoint — POST /messages delivers client messages
  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string
    const transport = transports[sessionId]
    if (!transport) {
      res.status(400).json({ error: "Unknown session" })
      return
    }
    await transport.handlePostMessage(req, res)
  })

  // ── Android push webhook ─────────────────────────────────────────────────
  // Accepts health data POSTs from Tasker / Health Connect automations.
  // Body: { api_key, user_id, date, sleep_hours?, deep_sleep_min?, rem_sleep_min?,
  //         light_sleep_min?, steps?, calories_burned?, active_minutes?,
  //         resting_hr?, weight_kg? }
  app.post("/push", async (req: Request, res: Response) => {
    const writeKey = process.env.MCP_WRITE_API_KEY
    if (!writeKey) {
      res.status(503).json({ error: "Push endpoint disabled: MCP_WRITE_API_KEY not set" })
      return
    }

    const { api_key, user_id, date, ...rest } = req.body as Record<string, unknown>

    if (api_key !== writeKey) {
      res.status(401).json({ error: "Invalid api_key" })
      return
    }
    if (!user_id || !date) {
      res.status(400).json({ error: "user_id and date are required" })
      return
    }

    try {
      const sleepDuration =
        rest.sleep_hours != null
          ? Math.round(Number(rest.sleep_hours) * 60)
          : undefined

      const row = await db.upsertHealthLog({
        userId: String(user_id),
        date: String(date),
        sleepDuration,
        deepSleep: rest.deep_sleep_min != null ? Number(rest.deep_sleep_min) : undefined,
        remSleep: rest.rem_sleep_min != null ? Number(rest.rem_sleep_min) : undefined,
        lightSleep: rest.light_sleep_min != null ? Number(rest.light_sleep_min) : undefined,
        steps: rest.steps != null ? Number(rest.steps) : undefined,
        caloriesBurned: rest.calories_burned != null ? Number(rest.calories_burned) : undefined,
        activeMinutes: rest.active_minutes != null ? Number(rest.active_minutes) : undefined,
        restingHR: rest.resting_hr != null ? Number(rest.resting_hr) : undefined,
        weight: rest.weight_kg != null ? Number(rest.weight_kg) : undefined,
        workouts: rest.workouts ?? undefined,
      })

      res.json({ ok: true, id: row.id })
    } catch (err) {
      console.error("[push] error:", err)
      res.status(500).json({ error: String(err) })
    }
  })

  // Health check
  app.get("/health", (_req, res) => res.json({ ok: true, server: "smartwatch-health-mcp" }))

  app.listen(PORT, () => {
    console.log(`Smartwatch Health MCP server listening on http://0.0.0.0:${PORT}`)
    console.log(`  SSE endpoint:      GET  /sse`)
    console.log(`  Messages endpoint: POST /messages`)
    console.log(`  Android push:      POST /push`)
  })
}
