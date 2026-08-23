import { describe, it, expect } from "vitest"
import { linkCodeValid, parseLinkCode, splitMessage } from "@/lib/telegram"

describe("splitMessage", () => {
  it("leaves a normal reply alone", () => {
    expect(splitMessage("Morning — 8.5h, HRV 113.")).toEqual(["Morning — 8.5h, HRV 113."])
  })

  it("splits past Telegram's limit, which Emergy will exceed", () => {
    const long = "x".repeat(9000)
    const parts = splitMessage(long)
    expect(parts.length).toBeGreaterThan(1)
    expect(Math.max(...parts.map(p => p.length))).toBeLessThanOrEqual(4000)
    expect(parts.join("")).toBe(long)
  })

  it("breaks where the text breaks, not mid-word", () => {
    const para = ("Sentence one is here.\n\n" + "word ".repeat(1200)).trim()
    const parts = splitMessage(para)
    expect(parts.length).toBeGreaterThan(1)
    // No part should end mid-word.
    for (const p of parts.slice(0, -1)) {
      expect(p.endsWith("word") || p.endsWith(".")).toBe(true)
    }
  })

  it("still cuts text that offers nowhere to break", () => {
    // A 9,000-character URL has no spaces; a hard cut beats refusing to send.
    const parts = splitMessage("y".repeat(9000))
    expect(parts.every(p => p.length <= 4000)).toBe(true)
  })
})

describe("link codes", () => {
  const now = Date.parse("2026-08-23T12:00:00Z")
  const stored = { code: "ABCD2345", expiresAt: now + 60_000 }

  it("round-trips through storage", () => {
    expect(parseLinkCode("ABCD2345:1234567890")).toEqual({ code: "ABCD2345", expiresAt: 1234567890 })
  })

  it("rejects anything unparseable rather than guessing", () => {
    for (const bad of [null, undefined, "", "nocolon", ":123", "ABC:notanumber"]) {
      expect(parseLinkCode(bad as string)).toBeNull()
    }
  })

  it("accepts the right code, typed in any case", () => {
    // It gets read off one screen and typed on another.
    expect(linkCodeValid(stored, "ABCD2345", now)).toBe(true)
    expect(linkCodeValid(stored, "abcd2345", now)).toBe(true)
    expect(linkCodeValid(stored, "  ABCD2345  ", now)).toBe(true)
  })

  it("refuses a prefix, a suffix, or the wrong code", () => {
    // Binding someone else's chat to this account is the worst outcome here,
    // so a near miss must be a miss.
    expect(linkCodeValid(stored, "ABCD", now)).toBe(false)
    expect(linkCodeValid(stored, "ABCD2345X", now)).toBe(false)
    expect(linkCodeValid(stored, "WXYZ9876", now)).toBe(false)
    expect(linkCodeValid(stored, "", now)).toBe(false)
  })

  it("expires", () => {
    expect(linkCodeValid(stored, "ABCD2345", now + 61_000)).toBe(false)
    expect(linkCodeValid(null, "ABCD2345", now)).toBe(false)
  })
})

// Link codes are the whole security boundary between a stranger's Telegram
// chat and someone's health record. These are the ways that could go wrong.
describe("link code hardening", () => {
  const now = Date.parse("2026-08-23T12:00:00Z")
  const stored = { code: "ABCD2345", expiresAt: now + 60_000 }

  it("is not fooled by a code that merely starts the same", () => {
    for (const near of ["A", "AB", "ABCD234", "ABCD2345 X", "ABCD2346"]) {
      expect(linkCodeValid(stored, near, now)).toBe(false)
    }
  })

  it("treats an already-expired code as no code", () => {
    // Redeeming is single-use in the caller; expiry is the second lock, so a
    // code left on screen does not stay live indefinitely.
    expect(linkCodeValid(stored, "ABCD2345", stored.expiresAt + 1)).toBe(false)
  })

  it("cannot be satisfied by an empty or whitespace code", () => {
    // A blank /start must never match a stored code.
    for (const blank of ["", "   ", "\n"]) {
      expect(linkCodeValid(stored, blank, now)).toBe(false)
    }
  })

  it("does not match a stored value that failed to parse", () => {
    expect(linkCodeValid(parseLinkCode("garbage"), "garbage", now)).toBe(false)
  })
})
