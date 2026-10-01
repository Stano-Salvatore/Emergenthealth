import { describe, it, expect } from "vitest"
import { parseDayInput, mergeDay, isEmptyDay, CYCLE_SYMPTOMS, CYCLE_MOODS } from "@/lib/cycle-input"

const TODAY = "2026-10-01"

describe("parseDayInput", () => {
  it("takes a flow for today", () => {
    expect(parseDayInput({ day: TODAY, flow: "heavy" }, TODAY)).toEqual({ ok: true, day: TODAY, data: { flow: "heavy" } })
  })

  it("only the fields sent change — an untouched field is left alone, a null clears it", () => {
    const p = parseDayInput({ day: TODAY, pain: 2, note: null }, TODAY)
    expect(p.ok && p.data).toEqual({ pain: 2, note: null })
  })

  it("refuses a future day, a day older than the history, and a malformed one", () => {
    expect(parseDayInput({ day: "2026-10-02", flow: "light" }, TODAY).ok).toBe(false)
    expect(parseDayInput({ day: "2024-01-01", flow: "light" }, TODAY).ok).toBe(false)
    expect(parseDayInput({ day: "yesterday", flow: "light" }, TODAY).ok).toBe(false)
  })

  it("drops values it does not know rather than storing them", () => {
    const p = parseDayInput({ day: TODAY, flow: "torrential", pain: 9, symptoms: ["cramps", "nonsense", "cramps"], discharge: "x", lhTest: "maybe" }, TODAY)
    expect(p.ok && p.data).toEqual({ symptoms: ["cramps"] })
  })

  it("knows the symptoms and moods the page offers", () => {
    expect(CYCLE_SYMPTOMS.map(s => s.key)).toContain("cramps")
    expect(CYCLE_MOODS.map(s => s.key)).toContain("irritable")
  })
})

describe("mergeDay", () => {
  it("adds symptoms to the day rather than replacing what is there, when asked to", () => {
    const merged = mergeDay({ symptoms: ["cramps"], moods: [] }, { symptoms: ["bloating"] }, { union: true })
    expect(merged.symptoms).toEqual(["cramps", "bloating"])
  })

  it("replaces them when the page sends the whole list", () => {
    expect(mergeDay({ symptoms: ["cramps"] }, { symptoms: ["bloating"] }).symptoms).toEqual(["bloating"])
  })
})

describe("isEmptyDay", () => {
  it("a day with everything cleared is no day at all", () => {
    expect(isEmptyDay({ flow: null, pain: null, symptoms: [], moods: [], discharge: null, lhTest: null, note: null })).toBe(true)
    expect(isEmptyDay({ flow: "none", symptoms: [] })).toBe(false) // "no bleeding today" is information
  })
})
