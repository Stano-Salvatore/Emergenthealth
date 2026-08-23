import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getStoredToken, getCurrentTimer, getTodayEntries, getProjects } from "@/lib/toggl"
import { getUserTimezone } from "@/lib/local-date"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const stored = await getStoredToken(session.user.id)
  if (!stored) return NextResponse.json({ connected: false })

  try {
    const [current, entries, projects] = await Promise.all([
      getCurrentTimer(stored.apiToken),
      getTodayEntries(stored.apiToken, await getUserTimezone(session.user.id)),
      stored.workspaceId ? getProjects(stored.apiToken, stored.workspaceId) : Promise.resolve([]),
    ])

    const totalSecondsToday = entries
      .filter(e => e.duration > 0)
      .reduce((s, e) => s + e.duration, 0)

    return NextResponse.json({
      connected: true,
      current,
      entries: entries.slice(0, 20),
      projects,
      totalSecondsToday,
      workspaceId: stored.workspaceId,
    })
  } catch (e) {
    console.error("[toggl/state]", e)
    return NextResponse.json({ connected: true, error: "Failed to load Toggl data", current: null, entries: [], projects: [], totalSecondsToday: 0 })
  }
}
