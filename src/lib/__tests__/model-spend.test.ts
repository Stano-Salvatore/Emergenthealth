import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { TURN_FEATURES } from "@/lib/model-spend"

// The Console reports one number for the whole organisation. It said $8.09 for
// September and could not say whether that went on chat, the weekly review, or
// one photographed lab printout. Six places call the API; this file is the
// guard that all six say who they were.

const files = {
  chat: "src/lib/claude.ts",
  briefing: "src/app/api/briefing/route.ts",
  "health report": "src/lib/health-report.ts",
  "weekly review": "src/lib/weekly-review.ts",
  "meal photo": "src/lib/food-analyze.ts",
  "lab document": "src/lib/lab-analyze.ts",
} as const

const src = Object.fromEntries(
  Object.entries(files).map(([feature, path]) => [feature, readFileSync(path, "utf8")]),
) as Record<string, string>

describe("every model call records what it cost", () => {
  it("covers each feature that spends money, and no orphans", () => {
    // The list and the call sites are one thing: a seventh caller with no
    // entry here, or an entry with no caller, is the drift this catches.
    expect([...TURN_FEATURES].sort()).toEqual(Object.keys(files).sort())
  })

  it.each(Object.keys(files))("%s calls recordModelTurn with its own name", feature => {
    expect(src[feature]).toContain("recordModelTurn")
    expect(src[feature]).toContain(`feature: "${feature}"`)
  })

  it.each(Object.keys(files))("%s passes the real usage object, not a guess", feature => {
    // A hand-built usage object would drift from the response the moment the
    // API adds a field; every caller hands over what it was given.
    expect(src[feature]).toMatch(/usage: (?:res|response)\.usage/)
  })

  it("never lets a failed insert cost the user their answer", () => {
    const spend = readFileSync("src/lib/model-spend.ts", "utf8")
    expect(spend).toMatch(/void prisma\.modelTurn\.create/)
    expect(spend).toMatch(/\}\)\.catch\(\(\) => \{\}\)/)
    // Not async, so no caller can accidentally await the write.
    expect(spend).toMatch(/export function recordModelTurn\(/)
    expect(spend).not.toMatch(/export async function recordModelTurn/)
  })

  it("keeps the price table out of the recorder", () => {
    // model-cost.ts is pure — no database, no clock — so the prices can be
    // tested without one. The recorder is the only half that touches Prisma.
    const cost = readFileSync("src/lib/model-cost.ts", "utf8")
    expect(cost).not.toContain("prisma")
  })

  it("threads the user into the two paths that had no one to bill", () => {
    // analyzeMealPhoto and analyzeLabDocument took only a data URL. A row
    // needs a user, and the routes are where one exists.
    expect(readFileSync("src/app/api/food/analyze/route.ts", "utf8")).toContain("userId: session.user.id")
    expect(readFileSync("src/app/api/labs/import/route.ts", "utf8")).toContain("analyzeLabDocument(document, session.user.id)")
  })

  it("maps the model onto the table it was born as", () => {
    // Renaming the table would be a drop and a create under `prisma db push`,
    // which the build runs without --accept-data-loss: the deploy would fail.
    const schema = readFileSync("prisma/schema.prisma", "utf8")
    expect(schema).toMatch(/model ModelTurn \{/)
    expect(schema).toMatch(/@@map\("ChatTurn"\)/)
    expect(schema).toMatch(/feature\s+String @default\("chat"\)/)
  })
})
