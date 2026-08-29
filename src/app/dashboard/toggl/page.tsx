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
      {/* The panel is a floating button and a drawer, so a page holding only
          it renders as a title over nothing. Anyone landing here — from the
          sidebar, or from a link — needs to be told where the thing they came
          for actually is. */}
      <div className="rounded-2xl border border-border/60 bg-card px-4 py-4 text-sm text-muted-foreground max-w-xl">
        <p className="text-foreground font-medium mb-1">The timer is the button, bottom right.</p>
        <p>
          Tap it to start or stop a timer, pick a project, and see today&apos;s entries.
          If Toggl isn&apos;t connected yet, that is where the API token goes — and it
          stays available on every screen, not only this one.
        </p>
      </div>

      <TogglPanel />
    </div>
  )
}
