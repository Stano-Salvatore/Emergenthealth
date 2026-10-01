import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"

// Sign-in asked every new person to let the app "see and download all your
// Google Drive files", for one feature: GPX tracks read from a single
// hard-coded folder in the owner's Drive. Location comes from the app's own
// GPS since the APK took over, so the scope and the reader are gone.

describe("Google Drive", () => {
  it("is not asked for at sign-in", () => {
    expect(readFileSync("src/auth.ts", "utf8")).not.toMatch(/auth\/drive/)
  })

  it("has no reader left to need it", () => {
    expect(existsSync("src/lib/google-drive.ts")).toBe(false)
    for (const f of ["src/app/api/location/route.ts", "src/components/dashboard/LocationCard.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/google-drive|getGpxTrackForDate|listGpxDates/)
    }
  })
})
