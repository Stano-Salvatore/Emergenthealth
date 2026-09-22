import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// A toggle is a promise. The Digest & Alerts card offered eleven of them and
// the only reader of the preference — the Sunday review email — consulted
// four. Mood, Focus, Weight, Strava, GitHub and Last.fm switched off changed
// nothing anywhere; Spending was a toggle for a feature that had been removed
// a release earlier. Nothing errored: a preference nobody reads is written
// just as happily as one somebody does.
//
// So the card may only offer a key the email asks about, by name, in code.

const CARD = "src/components/settings/DigestPreferences.tsx"
const EMAIL = "src/app/api/cron/emergy-weekly-review/route.ts"

const stripped = (file: string): string =>
  readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

/** The `key: "..."` entries of SECTION_META. */
const offered = (): string[] => {
  const src = stripped(CARD)
  const m = /const SECTION_META[^=]*=\s*\[([\s\S]*?)\n\]/.exec(src)
  if (!m) return []
  return [...m[1].matchAll(/key: "([a-z]+)"/g)].map(x => x[1])
}

/** Every key the email gates a tile on: on("...") */
const consulted = (): Set<string> =>
  new Set([...stripped(EMAIL).matchAll(/\bon\("([a-z]+)"\)/g)].map(m => m[1]))

describe("every digest toggle is read by the email it claims to shape", () => {
  it("finds the toggles at all", () => {
    expect(offered().length, `no SECTION_META entries found in ${CARD} — the guard is reading nothing`).toBeGreaterThan(0)
  })

  it("offers no toggle the Sunday review email ignores", () => {
    const reads = consulted()
    expect(reads.size, `no on("key") calls found in ${EMAIL} — did the gate move?`).toBeGreaterThan(0)
    for (const key of offered()) {
      expect(
        reads.has(key),
        `DigestPreferences offers a "${key}" toggle, but ${EMAIL} never asks on("${key}") — switching it does nothing.`,
      ).toBe(true)
    }
  })

  it("does not resurrect the finance toggle", () => {
    expect(offered()).not.toContain("spending")
  })
})
