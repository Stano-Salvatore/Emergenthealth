import { prisma } from "@/lib/prisma"
import { localDateStr, zonedDayRange } from "@/lib/local-date"

const BASE = "https://api.track.toggl.com"

export interface TogglEntry {
  id: number
  description: string | null
  start: string
  stop: string | null
  duration: number // negative = still running
  project_id: number | null
  workspace_id: number
  tags: string[]
}

export interface TogglProject {
  id: number
  name: string
  color: string
  workspace_id: number
  active: boolean
}

export interface TogglUser {
  id: number
  email: string
  fullname: string
  default_workspace_id: number
}

function basicAuth(apiToken: string) {
  return `Basic ${Buffer.from(`${apiToken}:api_token`).toString("base64")}`
}

async function togglFetch<T = unknown>(
  apiToken: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: basicAuth(apiToken),
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Toggl ${res.status}: ${text}`)
  }
  if (res.status === 204) return null as T
  return res.json() as Promise<T>
}

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "TogglToken" (
      "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "userId"      TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "apiToken"    TEXT NOT NULL,
      "workspaceId" INTEGER,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE("userId")
    )
  `
}

export async function getStoredToken(userId: string): Promise<{ apiToken: string; workspaceId: number | null } | null> {
  await ensureTable()
  const rows = await prisma.$queryRaw<{ apiToken: string; workspaceId: number | null }[]>`
    SELECT "apiToken", "workspaceId" FROM "TogglToken" WHERE "userId" = ${userId} LIMIT 1
  `
  return rows[0] ?? null
}

export async function saveToken(userId: string, apiToken: string, workspaceId: number) {
  await ensureTable()
  await prisma.$executeRaw`
    INSERT INTO "TogglToken"("userId","apiToken","workspaceId","updatedAt")
    VALUES (${userId}, ${apiToken}, ${workspaceId}, NOW())
    ON CONFLICT("userId") DO UPDATE SET
      "apiToken" = EXCLUDED."apiToken",
      "workspaceId" = EXCLUDED."workspaceId",
      "updatedAt" = NOW()
  `
}

export async function deleteToken(userId: string) {
  await ensureTable()
  await prisma.$executeRaw`DELETE FROM "TogglToken" WHERE "userId" = ${userId}`
}

// ── Toggl API calls ──────────────────────────────────────────────────────────

export async function verifyToken(apiToken: string): Promise<TogglUser> {
  return togglFetch<TogglUser>(apiToken, "/api/v9/me")
}

export async function getCurrentTimer(apiToken: string): Promise<TogglEntry | null> {
  return togglFetch<TogglEntry | null>(apiToken, "/api/v9/time_entries/current")
}

/**
 * Today's entries, where "today" is the caller's day and not the server's.
 *
 * new Date(y, m, d) is midnight wherever this code runs — UTC on Vercel — so
 * without a timezone the window silently belonged to the server. Anything
 * tracked between local midnight and the offset landed on the wrong day, and
 * for the first hours of the morning "today" was still yesterday.
 *
 * The timezone is optional so existing callers keep working; passing one is
 * what makes the answer right.
 */
export async function getTodayEntries(apiToken: string, timezone?: string): Promise<TogglEntry[]> {
  const day = timezone ? localDateStr(timezone) : new Date().toISOString().slice(0, 10)
  const { start: startAt, end: endAt } = timezone
    ? zonedDayRange(timezone, day)
    : { start: new Date(day + "T00:00:00.000Z"), end: new Date(day + "T23:59:59.999Z") }
  const start = startAt.toISOString()
  const end = endAt.toISOString()
  const entries = await togglFetch<TogglEntry[]>(
    apiToken, `/api/v9/time_entries?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`,
  )
  return entries ?? []
}

export async function getProjects(apiToken: string, workspaceId: number): Promise<TogglProject[]> {
  const projects = await togglFetch<TogglProject[]>(
    apiToken, `/api/v9/workspaces/${workspaceId}/projects?active=true`,
  )
  return projects ?? []
}

export async function startTimer(
  apiToken: string,
  workspaceId: number,
  description: string,
  projectId?: number | null,
): Promise<TogglEntry> {
  return togglFetch<TogglEntry>(apiToken, `/api/v9/workspaces/${workspaceId}/time_entries`, {
    method: "POST",
    body: JSON.stringify({
      description: description || "",
      start: new Date().toISOString(),
      duration: -1,
      workspace_id: workspaceId,
      project_id: projectId ?? null,
      created_with: "emergenthealth",
    }),
  })
}

export async function stopTimer(
  apiToken: string,
  workspaceId: number,
  timerId: number,
): Promise<TogglEntry> {
  return togglFetch<TogglEntry>(apiToken, `/api/v9/workspaces/${workspaceId}/time_entries/${timerId}/stop`, {
    method: "PATCH",
  })
}
