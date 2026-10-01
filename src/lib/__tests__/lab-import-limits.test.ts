import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// Vercel refuses a request body over 4.5 MB with a plain-text 413 before the
// route runs. The route used to accept 9.5M characters, so a 4 MB scanned PDF
// never reached its own "too large" message: the card's res.json() threw on
// the platform's body and the user was told "Couldn't read that file." — a
// size problem reported as a format one. And a long panel read by Opus at
// high effort was killed at 60 s, billed and never recorded.

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

const ROUTE = "src/app/api/labs/import/route.ts"
const CARD = "src/components/labs/LabImportCard.tsx"

describe("lab import stays inside what the platform will deliver", () => {
  it("caps the document below the 4.5 MB function body limit, JSON wrapper included", async () => {
    const { LAB_IMPORT_MAX_CHARS } = await import("@/lib/lab-import-limit")
    const body = JSON.stringify({ document: "x".repeat(LAB_IMPORT_MAX_CHARS) })
    expect(Buffer.byteLength(body)).toBeLessThan(4_500_000)
  })

  it("the route and the card use that one cap", () => {
    expect(strip(ROUTE)).toMatch(/document\.length > LAB_IMPORT_MAX_CHARS/)
    expect(strip(CARD)).toMatch(/document\.length > LAB_IMPORT_MAX_CHARS/)
  })

  it("the card survives a non-JSON error body and names size and time as such", () => {
    const card = strip(CARD)
    expect(card, "a bare res.json() throws on the platform's plain-text 413/504").not.toMatch(/await res\.json\(\)\s*\n/)
    expect(card).toMatch(/res\.json\(\)\.catch\(/)
    expect(card).toMatch(/status === 413/)
    expect(card).toMatch(/status === 504/)
  })

  it("gives an Opus high-effort read of a whole report more than 60 s", () => {
    const m = strip(ROUTE).match(/export const maxDuration = (\d+)/)
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(300)
  })
})
