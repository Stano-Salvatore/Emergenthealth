import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"

// A permission is added in one line of a Python script and answered for, months
// later, in a Play Console form written by somebody reading a markdown file.
// Nothing connects those two acts, and the gap is not hypothetical: the app
// declared ACCESS_BACKGROUND_LOCATION — the single permission Play scrutinises
// hardest, with its own declaration form and a demo video — and COMPLIANCE.md's
// permissions table did not mention it at all. So did RECORD_AUDIO,
// SYSTEM_ALERT_WINDOW and REQUEST_IGNORE_BATTERY_OPTIMIZATIONS.
//
// The submission would still have been made. That is the shape of this failure:
// nothing is broken, nothing is red, and the form gets filled in from an
// incomplete list by somebody who has no way of knowing it is incomplete.
//
// So: every `uses-permission` the build declares must have its name somewhere
// in COMPLIANCE.md. Not a good explanation — a test cannot judge that — but a
// row, which is the thing whose absence nobody notices.

const MANIFEST = ".ci/customize-android.py"
const COMPLIANCE = "play-store/COMPLIANCE.md"

// Not everything in the shipped manifest was written here. Android's manifest
// merger folds in each Capacitor plugin's own manifest, so a plugin can add a
// permission to the APK that appears in no file in this repository —
// `WAKE_LOCK` arrives that way, from local-notifications, and the Play listing
// shows it next to the ones we chose. An `npm install` can therefore change
// what the app asks for.
const pluginManifests = (): string[] => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"))
  return Object.keys(pkg.dependencies ?? {})
    .map(dep => `node_modules/${dep}/android/src/main/AndroidManifest.xml`)
    .filter(existsSync)
}

// Health permissions have their own section, their own form, and their own
// guard (`health-permissions-declared.test.ts`) that checks them one by one
// against the record types the app reads. Section 3 names the group.
const HEALTH_PREFIX = "android.permission.health."

const declared = (): string[] => {
  const found = [MANIFEST, ...pluginManifests()].flatMap(
    f => readFileSync(f, "utf8").match(/android\.permission\.[A-Z_]+/g) ?? [],
  )
  return [...new Set(found)]
    .filter(p => !p.startsWith(HEALTH_PREFIX))
    .map(p => p.slice("android.permission.".length))
    .sort()
}

describe("every declared Android permission is accounted for in COMPLIANCE.md", () => {
  it("has a row for each one", () => {
    const compliance = readFileSync(COMPLIANCE, "utf8")
    const undocumented = declared().filter(p => !compliance.includes(p))

    expect(
      undocumented,
      `The build declares ${undocumented.join(", ")}, and COMPLIANCE.md never mentions ${
        undocumented.length === 1 ? "it" : "them"
      }. ` +
        "Add a row to section 3 saying what the permission is for and what Play will ask about it — " +
        "that table is what the Console form gets filled in from.",
    ).toEqual([])
  })

  // The reverse drift: a permission taken out of the manifest but left in the
  // table reads as still-declared to whoever fills in the form, which is how
  // you end up declaring a sensitive permission the app does not hold. The
  // "deliberately absent" rows are the deliberate exception and say so.
  it("does not list permissions the build no longer declares", () => {
    const compliance = readFileSync(COMPLIANCE, "utf8")
    const absentSection = compliance.slice(compliance.indexOf("### Deliberately absent"))
    const declaredSection = compliance.slice(
      compliance.indexOf("### Declared"),
      compliance.indexOf("### Deliberately absent"),
    )
    expect(
      declaredSection.length,
      "COMPLIANCE.md section 3 no longer has a Declared / Deliberately absent split to check",
    ).toBeGreaterThan(0)

    const live = new Set(declared())
    // Only the first column. The second is prose and mentions plenty of
    // SCREAMING_CASE that is not a permission — `READ_TYPES`,
    // `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` — and excusing those by name would be
    // an allowlist that quietly grows to excuse a real one.
    const listed = declaredSection
      .split("\n")
      .filter(l => l.startsWith("|") && !/^\|\s*-+/.test(l))
      .flatMap(l => l.split("|")[1]?.match(/`([A-Z_]{4,})`/g) ?? [])
      .map(t => t.replaceAll("`", ""))
    const stale = [...new Set(listed)].filter(p => !live.has(p))

    expect(
      stale,
      `COMPLIANCE.md lists ${stale.join(", ")} under "Declared", but the build does not declare ${
        stale.length === 1 ? "it" : "them"
      } — ` +
        `move the row to "Deliberately absent" with the reason, or the form will be answered for a permission the app does not hold.` +
        (absentSection.length ? "" : " (No such section found.)"),
    ).toEqual([])
  })
})
