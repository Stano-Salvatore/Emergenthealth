import type { Metadata } from "next"
import { TogglPanel } from "@/components/toggl/TogglPanel"

export const metadata: Metadata = { title: "Toggl" }

// The panel — token setup, project picker, start/stop, today's entries — was
// written in full and then rendered by nothing: no route, no sidebar entry, no
// dashboard block. Its API routes (/api/toggl/state|start|stop|token) have
// been live the whole time. This is the page it was missing.
export default function TogglPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Toggl</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Time tracking — start, stop, and today&apos;s entries</p>
      </div>
      <TogglPanel />
    </div>
  )
}
