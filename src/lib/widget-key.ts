import { prisma } from "@/lib/prisma"

// Who a widget key belongs to — the home-screen widgets' and the background
// location service's way in, since neither carries a session.
//
// "No such key" and "could not look" are different answers and must stay
// different statuses. The phone's location service deletes its queued batch
// on a 401 (a dead key would refuse it forever) and keeps it on anything
// else; this lookup used to swallow its own database error as "no such key",
// so one cold connection answered 401 and hours of queued points were gone.

export type WidgetKeyResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 503; error: string }

export async function widgetKeyUser(apiKey: string): Promise<WidgetKeyResult> {
  if (!apiKey) return { ok: false, status: 401, error: "Missing API key" }
  try {
    const rows = await prisma.$queryRaw<{ userId: string }[]>`
      SELECT "userId" FROM "UserPreference"
      WHERE "key" = 'widget_api_key' AND "value" = ${apiKey}
      LIMIT 1
    `
    const userId = rows[0]?.userId
    return userId ? { ok: true, userId } : { ok: false, status: 401, error: "Invalid API key" }
  } catch (e) {
    console.error("[widget] key lookup failed", e instanceof Error ? e.message : e)
    return { ok: false, status: 503, error: "Temporarily unavailable" }
  }
}
