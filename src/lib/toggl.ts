import { prisma } from "@/lib/prisma"

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

export async function getTodayEntries(apiToken: string): Promise<TogglEntry[]> {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
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
