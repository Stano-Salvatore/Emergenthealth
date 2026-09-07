import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { SYNC_SOURCES } from "@/lib/sync-status"

// The inverse of scheduled-routes-exist.test.ts, and the gap that actually bit.
//
// That guard catches a schedule pointing at a route that's gone. This one
// catches a source with no schedule at all — which is worse, because it fails
// in the direction nobody looks. Last.fm and RescueTime were listed as sources,
// were read by the correlation engine, and had no cron: they synced only when
// the app happened to be opened, inside a Promise.allSettled that discarded
// the rejection. A revoked key looked exactly like a quiet week, for months.
//
// A source declared `driver: "server"` is making a promise the status screen
// repeats to the user — that silence from it is meaningful and can be called
// overdue. That promise is only true if something on a schedule actually runs
// it. Device-driven sources are exempt: the phone runs those, not us.

const SCHEDULED: string[] = (JSON.parse(readFileSync("vercel.json", "utf8")).crons ?? [])
  .map((c: { path?: string }) => c.path ?? "")

describe("every server-driven sync source is on a schedule", () => {
  it("has a cron for each one", () => {
    const unscheduled = SYNC_SOURCES
      .filter(s => s.driver === "server")
      .map(s => s.id)
      .filter(id => !SCHEDULED.includes(`/api/cron/${id}`))

    expect(unscheduled, [
      `No cron scheduled for: ${unscheduled.join(", ")}.`,
      "",
      'A source marked driver: "server" tells the status screen its silence is',
      "meaningful. Without a schedule that is a lie — it syncs only when the app",
      "is opened, and a broken connection is indistinguishable from a quiet week.",
      "",
      "Either add /api/cron/<id> to vercel.json, or mark the source as device-driven.",
    ].join("\n")).toEqual([])
  })
})
