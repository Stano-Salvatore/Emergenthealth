import { describe, it, expect, beforeAll } from "vitest"
import {
  issueConfirmToken, makeRef, parseRef, verifyConfirmToken,
} from "@/lib/log-refs"

beforeAll(() => { process.env.AUTH_SECRET = "test-secret-for-confirmation-tokens" })

const USER = "user_1"
const REF = makeRef("dose", "manual_abc")

describe("refs", () => {
  it("round-trips ids that contain colons", () => {
    // Prefixed ids are the norm here (manual_…), and a cuid is opaque — split
    // on the first colon only or a legitimate id could be truncated.
    expect(parseRef(makeRef("moment", "a:b:c"))).toEqual({ kind: "moment", id: "a:b:c" })
  })

  it("refuses a kind that isn't on the list", () => {
    // The allowlist is the whole point: anything not named here is untouchable,
    // so a hallucinated kind cannot reach a table it was never meant to.
    expect(parseRef("healthlog:123")).toBeNull()
    expect(parseRef("user:123")).toBeNull()
    expect(parseRef(":123")).toBeNull()
    expect(parseRef("dose:")).toBeNull()
    expect(parseRef("dose")).toBeNull()
  })
})

describe("confirmation tokens", () => {
  it("accepts the token it issued", () => {
    expect(verifyConfirmToken(USER, REF, issueConfirmToken(USER, REF))).toBe(true)
  })

  it("cannot be spent on a different record", () => {
    // The safety property that matters: even if Emergy described the wrong
    // entry, the confirmation only unlocks the one it was issued for.
    const token = issueConfirmToken(USER, REF)
    expect(verifyConfirmToken(USER, makeRef("dose", "manual_xyz"), token)).toBe(false)
    expect(verifyConfirmToken(USER, makeRef("moment", "manual_abc"), token)).toBe(false)
  })

  it("cannot be spent by a different user", () => {
    const token = issueConfirmToken(USER, REF)
    expect(verifyConfirmToken("user_2", REF, token)).toBe(false)
  })

  it("rejects anything the model might invent", () => {
    for (const bad of ["", "yes", "confirmed", "true", "0000000000000000"]) {
      expect(verifyConfirmToken(USER, REF, bad)).toBe(false)
    }
  })

  it("stays valid across a bucket boundary, then expires", () => {
    const t0 = 1_700_000_000_000
    const token = issueConfirmToken(USER, REF, t0)
    expect(verifyConfirmToken(USER, REF, token, t0 + 60_000)).toBe(true)
    // Still good one bucket later — a confirmation given just before the
    // boundary must not die a second afterwards.
    expect(verifyConfirmToken(USER, REF, token, t0 + 11 * 60_000)).toBe(true)
    // Gone by the time it's stale.
    expect(verifyConfirmToken(USER, REF, token, t0 + 25 * 60_000)).toBe(false)
  })
})
