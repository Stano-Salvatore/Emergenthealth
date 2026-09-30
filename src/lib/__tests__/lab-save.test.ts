import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"

// Every write of a lab result goes through the marker canonicaliser on the
// server. Emergy's tool and the import card's bulk save used to store the
// name as printed or as edited, so "Vitamín D" from a chat photo sat in a
// series of its own beside "Vitamin D" — the trend said "first reading", the
// nutrient card said vitamin D had never been measured, and a later import of
// the same report missed the dedupe and stored every value twice.

const db = vi.hoisted(() => ({
  existing: [] as { marker: string; value: number; date: Date }[],
  written: [] as Record<string, unknown>[],
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    labResult: {
      findMany: async (args: { where: { date: Date; marker: { in: string[] } } }) =>
        db.existing.filter(e => e.date.getTime() === args.where.date.getTime() && args.where.marker.in.includes(e.marker)),
      createMany: async (args: { data: Record<string, unknown>[] }) => {
        db.written.push(...args.data)
        return { count: args.data.length }
      },
    },
  },
}))

import { saveLabRows } from "@/lib/lab-save"

const row = (marker: string, value: number, unit = "mmol/l") => ({
  marker, value, unit, referenceMin: null, referenceMax: null, notes: null,
})

beforeEach(() => {
  db.existing = []
  db.written = []
})

describe("saveLabRows", () => {
  it("stores the canonical marker, not the printed one", async () => {
    const r = await saveLabRows("u1", "2026-09-01", [row("Vitamín D", 60, "nmol/l"), row("S-Kreatinín", 80, "umol/l")])
    expect(db.written.map(w => w.marker)).toEqual(["Vitamin D", "Creatinine"])
    expect(r.saved.map(s => s.marker)).toEqual(["Vitamin D", "Creatinine"])
  })

  it("recognises a row already on file under its canonical name", async () => {
    db.existing = [{ marker: "Cholesterol", value: 5.2, date: new Date("2026-09-01T00:00:00.000Z") }]
    const r = await saveLabRows("u1", "2026-09-01", [row("Cholesterol celkový", 5.2), row("HDL-cholesterol", 1.4)])
    expect(r.skipped).toBe(1)
    expect(db.written.map(w => w.marker)).toEqual(["HDL"])
  })

  it("drops a row whose name canonicalises to nothing", async () => {
    const r = await saveLabRows("u1", "2026-09-01", [row("   ", 1)])
    expect(r.saved).toEqual([])
    expect(db.written).toEqual([])
  })
})

describe("every lab write path canonicalises on the server", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("the chat tool saves through saveLabRows", () => {
    const chat = stripped("src/lib/claude.ts")
    const tool = chat.slice(chat.indexOf('name === "log_lab_results"'))
    expect(tool.slice(0, 3000)).toMatch(/saveLabRows\(/)
    expect(tool.slice(0, 3000)).not.toMatch(/labResult\.createMany/)
  })

  it("the bulk POST saves through saveLabRows and the single POST canonicalises", () => {
    const route = stripped("src/app/api/labs/route.ts")
    expect(route).toMatch(/saveLabRows\(/)
    expect(route).not.toMatch(/labResult\.createMany/)
    expect(route).toMatch(/canonicalMarker\(marker\)/)
    expect(route).toMatch(/marker:\s*canonical,/)
  })
})
