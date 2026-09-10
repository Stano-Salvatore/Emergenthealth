import { describe, it, expect } from "vitest"
import { judgeQuietSource, parseNotified, repeatDay } from "../quiet-source"

const base = {
  today: "2026-09-10",
  localHour: 12,
  newestSleepDay: "2026-09-10",
  lastRun: { at: "2026-09-10T08:00:00Z", ok: true },
  notified: null,
}

describe("judgeQuietSource", () => {
  it("says nothing while last night is there", () => {
    expect(judgeQuietSource(base)).toBeNull()
  })

  it("one missing night is a late sync, not a quiet ring", () => {
    expect(judgeQuietSource({ ...base, newestSleepDay: "2026-09-09" })).toBeNull()
  })

  it("two missing nights is worth one push, with the count in it", () => {
    const n = judgeQuietSource({ ...base, newestSleepDay: "2026-09-08" })
    expect(n?.key).toBe("quiet:2026-09-08")
    expect(n?.body).toContain("2 nights missing")
    expect(n?.body).toContain("Tuesday 8 September")
  })

  it("the same spell is not raised twice", () => {
    const notified = { key: "quiet:2026-09-08", at: "2026-09-10T11:00:00Z" }
    expect(judgeQuietSource({ ...base, newestSleepDay: "2026-09-08", today: "2026-09-11", notified })).toBeNull()
  })

  it("but a spell that drags on for a week is raised again", () => {
    const notified = { key: "quiet:2026-09-08", at: "2026-09-10T11:00:00Z" }
    expect(judgeQuietSource({ ...base, newestSleepDay: "2026-09-08", today: repeatDay("2026-09-10"), notified })).not.toBeNull()
  })

  it("a new night followed by a new silence is a new spell", () => {
    const notified = { key: "quiet:2026-09-01", at: "2026-09-03T11:00:00Z" }
    const n = judgeQuietSource({ ...base, newestSleepDay: "2026-09-08", notified })
    expect(n?.key).toBe("quiet:2026-09-08")
  })

  it("a failing sync outranks a quiet ring, and names the error", () => {
    const n = judgeQuietSource({
      ...base,
      newestSleepDay: "2026-09-05",
      lastRun: { at: "2026-09-10T08:00:00Z", ok: false, error: "token revoked" },
    })
    expect(n?.key).toBe("sync-failing")
    expect(n?.body).toContain("token revoked")
    expect(n?.body).toContain("Data connections")
  })

  it("never pushes at night or before ten", () => {
    expect(judgeQuietSource({ ...base, newestSleepDay: "2026-09-01", localHour: 3 })).toBeNull()
    expect(judgeQuietSource({ ...base, newestSleepDay: "2026-09-01", localHour: 9 })).toBeNull()
    expect(judgeQuietSource({ ...base, newestSleepDay: "2026-09-01", localHour: 20 })).toBeNull()
  })

  it("a ring that never produced a night is not a quiet ring", () => {
    expect(judgeQuietSource({ ...base, newestSleepDay: null })).toBeNull()
  })
})

describe("parseNotified", () => {
  it("tolerates garbage", () => {
    expect(parseNotified(null)).toBeNull()
    expect(parseNotified("nope")).toBeNull()
    expect(parseNotified('{"key":"x"}')).toBeNull()
    expect(parseNotified('{"key":"x","at":"2026-09-10T00:00:00Z"}')).toEqual({ key: "x", at: "2026-09-10T00:00:00Z" })
  })
})
