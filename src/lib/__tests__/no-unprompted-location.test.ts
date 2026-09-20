import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// Opening the dashboard used to raise a location permission dialog. Twice, in
// fact — `WeatherWidget` and `PlaceDetector` each asked for a position in a
// mount effect, so the first screen of the app, on a first launch, was a
// system prompt with nothing on screen explaining it. The weather one then
// pulsed a grey skeleton in the greeting card for up to fifteen seconds while
// the person decided, and if they said no, forever after showed nothing.
//
// A Play reviewer meets exactly that: install, open, get asked for location by
// a clock. It is also the thing the background-location disclosure work in
// this PR is about — asking at the point of use, having said what for.
//
// Both now call `locationAlreadyGranted()` first, which answers from
// `checkPermissions` (native) or the Permissions API (web) without prompting,
// and stay quiet unless the answer is a definite yes.
//
// This is NOT a blanket rule and the list below is not an allowlist of
// forgiven files. Screens a person opens in order to turn location on —
// Settings' weather-location picker, the background-location card, the
// permission list — *should* prompt: there the dialog is the answer to
// something they just asked for. The rule is about surfaces that run by
// themselves, and these two are the ones that do.
const SELF_STARTING = [
  "src/components/dashboard/WeatherWidget.tsx",
  "src/components/dashboard/PlaceDetector.tsx",
]

describe("the dashboard does not ask for location on its own", () => {
  it.each(SELF_STARTING)("%s checks the grant before asking for a position", file => {
    const src = readFileSync(file, "utf8")

    const asks = /getCurrentPosition\s*\(/.test(src)
    if (!asks) return // no longer reads a position at all; nothing to guard

    expect(
      src.includes("locationAlreadyGranted"),
      `${file} reads a position but never checks whether location is already granted. ` +
        "It runs when the dashboard mounts, so that call raises a permission dialog on the " +
        "first screen of the app with nothing explaining it — ask from Settings instead.",
    ).toBe(true)
  })

  // The helper is only honest if it cannot itself prompt. `checkPermissions`
  // and `permissions.query` answer from what has already been decided;
  // `requestPermissions` and `getCurrentPosition` are the things that ask.
  it("the grant check cannot itself raise a prompt", () => {
    const src = readFileSync("src/lib/native/geolocation.ts", "utf8")
    const fn = src.slice(
      src.indexOf("export async function locationAlreadyGranted"),
      src.indexOf("export async function getCurrentPosition"),
    )
    expect(fn.length, "locationAlreadyGranted is gone — this guard needs rewriting").toBeGreaterThan(0)

    for (const asking of ["requestPermissions", "getCurrentPosition"]) {
      expect(
        fn.includes(asking),
        `locationAlreadyGranted calls ${asking}, which prompts — the whole point of it is that ` +
          "it can be called without asking anybody anything.",
      ).toBe(false)
    }
  })
})
