import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { READ_TYPES } from "@/lib/health-connect-service"

// Every record type the app asks for needs its own line in the Android
// manifest. Health Connect grants nothing the manifest has not declared, and
// it does not say so: the plugin's read throws, `safeRead` catches it and
// returns `[]`, which is indistinguishable from a type that genuinely has no
// records. A ring taken off for a night looks exactly like a permission that
// can never be granted — except the second one lasts forever.
//
// Both directions are wrong, and both are silent:
//
//   asked for, not declared → the metric is simply always missing
//   declared, not asked for → a sensitive health permission on the Play
//                             health-apps form with no feature behind it
//
// The mapping below is not mechanical, so it was not guessed. It is read out
// of the library this build links — androidx.health.connect:connect-client
// 1.1.0, pinned in the plugin's own build.gradle — by disassembling the static
// map in `HealthPermission`:
//
//   javap -p -c androidx/health/connect/client/permission/HealthPermission.class
//
// which pairs each Record class with its permission string. Three of the eight
// are not what the type name suggests:
//
//   SleepSession              → READ_SLEEP                  (no _SESSION)
//   HeartRateVariabilityRmssd → READ_HEART_RATE_VARIABILITY (no _RMSSD)
//   RestingHeartRate          → READ_RESTING_HEART_RATE     (its own permission,
//                                                            NOT READ_HEART_RATE)
//
// That last one is why this test exists. READ_HEART_RATE grants HeartRateRecord
// — "HeartRateSeries" to the plugin — which nothing here reads, and it does not
// grant resting heart rate. So the app was declaring a permission it never used
// and using one it never declared, and the account it was built on gets resting
// heart rate from an Oura ring either way, so nothing ever looked wrong.
//
// The plugin's own name for each type is the key: it is what `READ_TYPES`
// holds, and `RecordTypeRegistry` turns it into the AndroidX Record class.
const HEALTH_PERMISSION: Record<string, string> = {
  Steps: "READ_STEPS",
  SleepSession: "READ_SLEEP",
  RestingHeartRate: "READ_RESTING_HEART_RATE",
  HeartRateVariabilityRmssd: "READ_HEART_RATE_VARIABILITY",
  OxygenSaturation: "READ_OXYGEN_SATURATION",
  Weight: "READ_WEIGHT",
  ActiveCaloriesBurned: "READ_ACTIVE_CALORIES_BURNED",
  TotalCaloriesBurned: "READ_TOTAL_CALORIES_BURNED",
}

const PREFIX = "android.permission.health."

// Two places name these permissions. The first is the only one that reaches an
// APK — CI regenerates the manifest every build, so it cannot be committed and
// this script writes it. The second is the copy-paste block ANDROID_SETUP.md
// sends a human to for a hand-built project; it ships no code, which is
// precisely why it rots unnoticed and then hands someone the wrong list.
const MANIFEST_SOURCES = [
  ".ci/customize-android.py",
  "android-widget/manifest_additions.xml",
]

const declaredPermissions = (file: string): string[] => {
  const found = readFileSync(file, "utf8").match(/android\.permission\.health\.[A-Z_]+/g)
  return [...new Set(found ?? [])].map(p => p.slice(PREFIX.length)).sort()
}

describe("Health Connect permissions match the types the app reads", () => {
  // A type added to READ_TYPES with no entry here would otherwise skip every
  // assertion below and pass — the failure mode the whole file exists to stop.
  it("knows the permission for every type it asks for", () => {
    expect(Object.keys(HEALTH_PERMISSION).sort()).toEqual([...READ_TYPES].sort())
  })

  it.each(MANIFEST_SOURCES)("declares exactly those permissions in %s, and no others", file => {
    const expected = READ_TYPES.map(t => HEALTH_PERMISSION[t]).sort()
    const declared = declaredPermissions(file)

    const missing = expected.filter(p => !declared.includes(p))
    const extra = declared.filter(p => !expected.includes(p))

    expect(
      missing,
      `READ_TYPES asks for ${missing.join(", ")}, which ${file} never declares — ` +
        "Health Connect will refuse those reads on every phone, silently and forever.",
    ).toEqual([])

    expect(
      extra,
      `${file} declares ${extra.join(", ")}, which nothing in READ_TYPES reads — ` +
        "Play's health-apps form asks what each declared type is for, and there is no answer for an unused one.",
    ).toEqual([])
  })

  // The Play form is filled in from COMPLIANCE.md, by hand, months after the
  // manifest last changed. Nothing imports a markdown file, so this is the
  // only thing that can notice it has gone stale.
  it("keeps COMPLIANCE.md listing the same permissions", () => {
    const compliance = readFileSync("play-store/COMPLIANCE.md", "utf8")
    const section = compliance.slice(
      compliance.indexOf("## 1."),
      compliance.indexOf("## 2."),
    )
    expect(section.length, "COMPLIANCE.md no longer has a section 1 to check").toBeGreaterThan(0)

    for (const type of READ_TYPES) {
      const perm = HEALTH_PERMISSION[type]
      expect(
        section.includes(perm),
        `COMPLIANCE.md's health-apps declaration does not list ${perm}, which the app reads`,
      ).toBe(true)
    }

    // READ_HEART_RATE contains READ_HEART_RATE_VARIABILITY as a substring
    // nowhere, but it IS a prefix of nothing else in the list — a plain
    // includes() would still be fooled by "READ_HEART_RATE_VARIABILITY"
    // containing "READ_HEART_RATE". Match on a boundary instead.
    const stale = section.match(/READ_[A-Z_]+/g) ?? []
    const allowed = new Set(READ_TYPES.map(t => HEALTH_PERMISSION[t]))
    const listedButUnread = [...new Set(stale)].filter(p => !allowed.has(p))
    expect(
      listedButUnread,
      `COMPLIANCE.md's health-apps declaration lists ${listedButUnread.join(", ")}, which the app does not read — ` +
        "that list is copied into the Play form, so it would be declaring a type it has no feature for.",
    ).toEqual([])
  })
})
