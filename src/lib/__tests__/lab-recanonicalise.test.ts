import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { planLabTidy, type TidyRow } from "@/lib/lab-recanonicalise"

// Rows saved before 3.8.0 keep the names the marker map gave them then:
// "LDL-cholesterol" as a series of its own, "Vitamín D" from a chat photo
// beside "Vitamin D". The owner can't run a script against production, so
// the app plans the tidy and applies only what it can stand behind.

let n = 0
const row = (marker: string, value: number, unit: string, date = "2025-04-01"): TidyRow => ({
  id: `r${++n}`, marker, unit, value, date,
})

describe("planLabTidy", () => {
  it("renames rows whose name now canonicalises to something else", () => {
    const rows = [
      row("LDL-cholesterol", 3.1, "mmol/l"),
      row("Vitamín D", 60, "nmol/l"),
      row("Vitamin D", 55, "nmol/l", "2025-09-01"),
    ]
    const plan = planLabTidy(rows)
    expect(plan.renames.map(r => [r.from, r.to])).toEqual([
      ["LDL-cholesterol", "LDL"],
      ["Vitamín D", "Vitamin D"],
    ])
    expect(plan.renames.map(r => r.id)).toEqual([rows[0].id, rows[1].id])
    expect(plan.needsALook).toEqual([])
  })

  it("plans nothing on its own output", () => {
    const rows = [
      row("LDL-cholesterol", 3.1, "mmol/l"),
      row("S-Kreatinín", 80, "umol/l"),
      row("hdl cholesterol", 1.4, "mmol/l"),
      row("Ferritin", 120, "ug/l"),
    ]
    const plan = planLabTidy(rows)
    const to = new Map(plan.renames.map(r => [r.id, r.to]))
    const after = rows.map(r => ({ ...r, marker: to.get(r.id) ?? r.marker }))
    expect(planLabTidy(after).renames).toEqual([])
  })

  it("reports a rename that would put two results under one name on one day, and applies neither", () => {
    const rows = [
      row("HDL", 1.4, "mmol/l"),
      row("HDL-cholesterol", 1.4, "mmol/l"),
      // Two old spellings landing on one name on the same day.
      row("LDL-cholesterol", 3.1, "mmol/l", "2025-06-01"),
      row("Cholesterol LDL", 3.0, "mmol/l", "2025-06-01"),
    ]
    const plan = planLabTidy(rows)
    expect(plan.renames).toEqual([])
    const looks = plan.needsALook.filter(l => l.kind === "collision")
    expect(looks.map(l => l.id).sort()).toEqual([rows[1].id, rows[2].id, rows[3].id].sort())
    expect(looks.find(l => l.id === rows[1].id)!.reason).toMatch(/HDL/)
  })

  it("still renames a row whose new name is free on its own day", () => {
    const rows = [
      row("HDL", 1.4, "mmol/l", "2025-01-01"),
      row("HDL-cholesterol", 1.3, "mmol/l", "2025-06-01"),
    ]
    expect(planLabTidy(rows).renames.map(r => r.id)).toEqual([rows[1].id])
  })

  it("flags Urea in mg/dL for a person to decide, and never renames it", () => {
    const rows = [
      row("Urea", 14, "mg/dL"),
      row("urea", 15, "mg/dl", "2025-06-01"),
      row("Urea", 5.1, "mmol/l", "2025-09-01"),
    ]
    const plan = planLabTidy(rows)
    expect(plan.renames).toEqual([])
    const urea = plan.needsALook.filter(l => l.kind === "urea-mg-dl")
    expect(urea.map(l => l.id)).toEqual([rows[0].id, rows[1].id])
    expect(urea[0].reason).toMatch(/BUN/)
  })

  it("points out two results under one name on one day, which a name can't fix", () => {
    // HDL saved under "Cholesterol" by the old prefix match: the name it was
    // printed under is gone, so only a person can say which is which.
    const rows = [
      row("Cholesterol", 5.2, "mmol/l"),
      row("Cholesterol", 1.4, "mmol/l"),
      row("Cholesterol", 5.0, "mmol/l", "2025-09-01"),
    ]
    const plan = planLabTidy(rows)
    expect(plan.renames).toEqual([])
    const same = plan.needsALook.filter(l => l.kind === "same-day")
    expect(same.map(l => l.id)).toEqual([rows[0].id, rows[1].id])
  })

  it("is empty for a record that is already tidy", () => {
    expect(planLabTidy([row("Ferritin", 120, "ug/l"), row("TSH", 2.1, "mIU/l")])).toEqual({ renames: [], needsALook: [], limits: [] })
  })

  it("moves a < or > that 3.8.0 kept only in the note into its column", () => {
    const rows = [
      { ...row("CRP", 5, "mg/l"), notes: "Printed as <5 (a limit, not an exact value). Imported from Unilabs" },
      { ...row("eGFR", 90, "ml/min", "2025-06-01"), notes: "Printed as >90 (a limit, not an exact value). Imported from a document" },
      // Already moved, a note that doesn't match the value, and a user's own note.
      { ...row("CRP", 5, "mg/l", "2025-07-01"), notes: "Printed as <5 (a limit, not an exact value).", qualifier: "<" },
      { ...row("CRP", 4, "mg/l", "2025-08-01"), notes: "Printed as <5 (a limit, not an exact value)." },
      { ...row("CRP", 3, "mg/l", "2025-09-01"), notes: "less than 5 I think" },
    ]
    const plan = planLabTidy(rows)
    expect(plan.limits.map(l => [l.id, l.qualifier])).toEqual([[rows[0].id, "<"], [rows[1].id, ">"]])
    const q = new Map(plan.limits.map(l => [l.id, l.qualifier]))
    expect(planLabTidy(rows.map(r => ({ ...r, qualifier: q.get(r.id) ?? r.qualifier }))).limits).toEqual([])
  })
})

describe("the tidy route", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
  const route = stripped("src/app/api/labs/tidy/route.ts")

  it("reads and writes only the signed-in user's rows", () => {
    expect(route).toMatch(/auth\(\)/)
    expect(route).toMatch(/labResult\.findMany\(\{\s*where: \{ userId \}/)
    const post = route.slice(route.indexOf("export async function POST"))
    expect(post).toMatch(/updateMany\(\{\s*where: \{ id: r\.id, userId, marker: r\.from \}/)
    expect(post).not.toMatch(/labResult\.update\(/)
    expect(post).not.toMatch(/delete/i)
  })

  it("plans on the server and applies only the plain renames, in one transaction", () => {
    const post = route.slice(route.indexOf("export async function POST"))
    expect(route).toMatch(/planLabTidy\(/)
    expect(post).toMatch(/await plan\(userId\)/)
    expect(post).toMatch(/\$transaction\(/)
    expect(post).toMatch(/p\.renames\.map\(/)
    expect(post).toMatch(/updateMany\(\{\s*where: \{ id: l\.id, userId, qualifier: null \}/)
    expect(post).not.toMatch(/needsALook\.map\(/)
    // Nothing the client sends decides what is renamed.
    expect(post).not.toMatch(/req\.json\(\)/)
  })
})
