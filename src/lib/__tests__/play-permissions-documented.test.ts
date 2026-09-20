import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"

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

// Not everything in the shipped manifest was written here, and the ones that
// were not are exactly the ones nobody thinks to write down.
//
// Two other sources reach the APK:
//
//   1. Android's manifest merger folds in each Capacitor plugin's own
//      manifest. `WAKE_LOCK` arrives that way, from local-notifications, and
//      the Play listing shows it beside the ones we chose. An `npm install`
//      can change what the app asks for.
//
//   2. `npx cap add android` unpacks a project template, and that template's
//      manifest declares `INTERNET` before a line of this repo's code runs.
//      It is generated in CI and gitignored, so the file never exists when
//      this test runs — the template tarball it comes from does.
//
// The second one was missed on the first pass of this guard, which then said
// in its own words that every declared permission had a row. It did not.
const pluginManifests = (): string[] => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"))
  return Object.keys(pkg.dependencies ?? {})
    .map(dep => `node_modules/${dep}/android/src/main/AndroidManifest.xml`)
    .filter(existsSync)
}

const TEMPLATE_TARBALL = "node_modules/@capacitor/cli/assets/android-template.tar.gz"
const TEMPLATE_MANIFEST = "app/src/main/AndroidManifest.xml"

/** The base manifest `cap add android` starts from, read out of its tarball. */
const templateManifest = (): string => {
  if (!existsSync(TEMPLATE_TARBALL)) return ""
  try {
    return execFileSync("tar", ["-xzOf", TEMPLATE_TARBALL, TEMPLATE_MANIFEST], {
      encoding: "utf8",
    })
  } catch {
    return ""
  }
}

// Health permissions have their own section, their own form, and their own
// guard (`health-permissions-declared.test.ts`) that checks them one by one
// against the record types the app reads. Section 3 names the group.
const HEALTH_PREFIX = "android.permission.health."

// Only `<uses-permission>` — a permission the app ASKS FOR. A component can
// also carry `android:permission="…"`, which is a permission it DEMANDS of
// whoever calls it: the rationale activity-alias requires the system's
// START_VIEW_PERMISSION_USAGE so that "exported" does not mean "by anyone".
// That is the opposite direction, it never appears on the Play listing, and
// matching the bare string put it on this guard's list of things to explain.
const USES_PERMISSION = /<uses-permission[^>]*android:name="([^"]+)"/g

const permissionsIn = (xml: string): string[] =>
  [...xml.matchAll(USES_PERMISSION)].map(m => m[1])

const declared = (): string[] => {
  const found = [
    ...permissionsIn(templateManifest()),
    ...[MANIFEST, ...pluginManifests()].flatMap(f => permissionsIn(readFileSync(f, "utf8"))),
  ]
  return [...new Set(found)]
    // Health permissions have their own section, their own Play form and their
    // own guard, which checks them one by one against the record types read.
    .filter(p => !p.startsWith(HEALTH_PREFIX))
    .map(p => p.replace(/^android\.permission\./, ""))
    .sort()
}

describe("every declared Android permission is accounted for in COMPLIANCE.md", () => {
  // Red on purpose if the template's layout changes. A source this guard can
  // no longer read is a source it silently stops covering, and the whole point
  // of the file is that a permission nobody wrote down is a permission nobody
  // notices. Better to be told the guard shrank than to believe a clean run.
  it("can still read the Capacitor project template", () => {
    expect(
      existsSync(TEMPLATE_TARBALL),
      `${TEMPLATE_TARBALL} is gone — 'cap add android' gets its base manifest from somewhere else now, ` +
        "and whatever that is needs adding here before this guard means anything.",
    ).toBe(true)

    expect(
      templateManifest().includes("<manifest"),
      `Could not read ${TEMPLATE_MANIFEST} out of ${TEMPLATE_TARBALL}. The template's layout has changed, ` +
        "so the permissions it contributes are no longer being checked — find the new path.",
    ).toBe(true)
  })

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
