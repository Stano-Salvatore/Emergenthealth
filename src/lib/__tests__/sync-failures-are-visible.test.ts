import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// A failing Health Connect sync looked exactly like a quiet one: safeRead
// turned a refused record type into an empty list, the auto-sync swallowed
// the POST failure whole, and the Settings card inferred health from a
// timestamp written only on success — so "the sync is broken" presented as
// "nothing happened this week", the same silence the guláš taught chat not
// to keep. Every sync run now records its outcome — success with the types
// the phone refused THIS run, or the failure and its reason — and the card
// reads it back where it can be acted on.

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

describe("the sync records its own outcome", () => {
  const svc = strip("src/lib/health-connect-service.ts")

  it("failed per-type reads are collected, not erased", () => {
    expect(svc).toMatch(/failedTypes/)
  })
  it("both endings write the outcome — success with partials, failure with its reason", () => {
    expect(svc).toMatch(/SYNC_OUTCOME_KEY/)
    expect(svc).toMatch(/ok: true/)
    expect(svc).toMatch(/ok: false/)
  })
  it("the outcome is readable back, guarded against missing storage", () => {
    expect(svc).toMatch(/export function lastSyncOutcome/)
    const open = svc.indexOf("export function lastSyncOutcome")
    const body = svc.slice(open, svc.indexOf("\nexport", open + 1))
    expect(body).toMatch(/try/)
  })
})

describe("the Settings card says it out loud", () => {
  const card = strip("src/components/settings/HealthConnectManager.tsx")

  it("reads the last outcome", () => {
    expect(card).toMatch(/lastSyncOutcome\(/)
  })
  it("a failed run and a partial run each get their own line", () => {
    expect(card).toMatch(/last sync attempt failed/i)
    expect(card).toMatch(/refused/i)
  })
})
