import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { TURN_FEATURES } from "@/lib/model-spend"

// The Console reports one number for the whole organisation. It said $8.09 for
// September and could not say whether that went on chat, the weekly review, or
// one photographed lab printout. Six places call the API; this file is the
// guard that all six say who they were.

/**
 * Every file under src/ that asks a model for something. Found by walking the
 * tree rather than listed by hand, which is the whole point: the first version
 * of this test carried a hand-written list of six files and passed while a
 * seventh caller — the habit garden — spent money unrecorded. A list can only
 * guard the callers its author remembered.
 */
function callSites(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== "__tests__") walk(path)
      } else if (/\.tsx?$/.test(e.name)) {
        const text = readFileSync(path, "utf8")
        // Both entry points: chat streams, everything else creates. Missing
        // `stream` was the second version of this test's own blind spot.
        if (/\bmessages\.(?:create|stream)\(/.test(text)) out.push(path)
      }
    }
  }
  walk("src")
  return out.sort()
}

const SITES = callSites()

describe("every model call records what it cost", () => {
  it("found the call sites at all", () => {
    // A tree walk that matches nothing passes every assertion below it
    // beautifully. This is the assertion that the walk worked.
    expect(SITES.length).toBeGreaterThanOrEqual(7)
  })

  it.each(SITES)("%s records the turn it just spent", path => {
    const text = readFileSync(path, "utf8")
    expect(text).toContain("recordModelTurn")
    // Named as one of the features, so the row can be grouped by it.
    const named = TURN_FEATURES.filter(f => text.includes(`feature: "${f}"`))
    expect(named.length).toBeGreaterThan(0)
  })

  it.each(SITES)("%s passes the real usage object, not a guess", path => {
    // A hand-built usage object would drift from the response the moment the
    // API adds a field; every caller hands over what it was given.
    expect(readFileSync(path, "utf8")).toMatch(/usage: (?:res|response)\.usage/)
  })

  it("has no feature nobody spends on", () => {
    const all = SITES.map(p => readFileSync(p, "utf8")).join("\n")
    const orphans = TURN_FEATURES.filter(f => !all.includes(`feature: "${f}"`))
    expect(orphans).toEqual([])
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
    // Whitespace-tolerant on purpose: `prisma format` owns the column
    // alignment in this file and re-aligns it whenever a model is added
    // elsewhere, so a literal single space here fails on a formatting run
    // that changed nothing about this column.
    expect(schema).toMatch(/feature\s+String\s+@default\("chat"\)/)
  })
})
