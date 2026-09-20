import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { SCREEN_TIME_READABLE } from "@/lib/native/screen-time"

// Screen time is readable only if two files agree, and they live a world
// apart: a TypeScript constant the UI reads, and a Python script that writes
// the Android manifest in CI. Android lists an app under Settings → Usage
// access only if the manifest declares PACKAGE_USAGE_STATS, so a constant
// saying "yes" over a manifest saying nothing produces exactly the bug this
// replaced — a card telling people to grant something no screen on their
// phone offers.
//
// It can drift in both directions and both are bad:
//
//   constant true, permission absent  → the dead "Open Usage Access" button
//   constant false, permission present → a granted permission nothing reads,
//                                        and a Play Console declaration made
//                                        for a feature that stays switched off
//
// The second is the one that bites later: Play asks why a sensitive
// permission is declared, and "it isn't" is not an answer the form takes.

const MANIFEST_SOURCES = [
  ".ci/customize-android.py",
  "android-widget/manifest_additions.xml",
]

describe("screen time is readable exactly when the manifest allows it", () => {
  it("matches PACKAGE_USAGE_STATS in the generated manifest", () => {
    const declaredIn = MANIFEST_SOURCES.filter(f =>
      readFileSync(f, "utf8").includes("android.permission.PACKAGE_USAGE_STATS"))

    expect(
      declaredIn.length > 0,
      declaredIn.length > 0
        ? `PACKAGE_USAGE_STATS is declared in ${declaredIn.join(", ")}, so SCREEN_TIME_READABLE should be true — ` +
          "or the declaration should come out, because Play will ask what reads it."
        : "PACKAGE_USAGE_STATS is declared nowhere, so SCREEN_TIME_READABLE must be false — " +
          "without it Android never offers Usage access, and the UI would be asking for something unobtainable.",
    ).toBe(SCREEN_TIME_READABLE)
  })

  // The compliance note is the reason the permission is absent. If someone
  // declares it, that note is the next thing that has to change, and it is
  // easy to miss because nothing imports a markdown file.
  it("keeps the compliance note and the manifest telling the same story", () => {
    const compliance = readFileSync("play-store/COMPLIANCE.md", "utf8")
    const saysDoNotDeclare = /PACKAGE_USAGE_STATS[^\n]*do not declare/i.test(compliance)
    if (!SCREEN_TIME_READABLE) {
      expect(saysDoNotDeclare, "COMPLIANCE.md should still carry the row explaining why it is absent").toBe(true)
    } else {
      expect(saysDoNotDeclare, "COMPLIANCE.md still says do not declare, but the build now does").toBe(false)
    }
  })
})
