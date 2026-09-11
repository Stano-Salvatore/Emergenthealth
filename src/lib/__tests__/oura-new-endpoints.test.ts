import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// These four endpoints were added from API documentation rather than from a
// payload in hand, which is the exact situation that produced the longest-lived
// bug in this integration: `awake_time` was read as `awake_duration` and came
// back null on every night ever synced, invisibly, because the document is
// Record<string, unknown> and a key that does not exist looks identical to a
// night with no figure.
//
// So the rule for any mapper written from docs is that a document mapping to
// nothing has to say so. These tests hold that rule in place, and hold the new
// columns to the standard the sleep fields failed for months: stored is not
// enough, something has to read them.

const oura = readFileSync("src/lib/oura.ts", "utf8")
const sync = readFileSync("src/lib/oura-sync.ts", "utf8")
const chat = readFileSync("src/lib/claude.ts", "utf8")
const healthPage = readFileSync("src/app/dashboard/health/page.tsx", "utf8")
const schema = readFileSync("prisma/schema.prisma", "utf8")

const FETCHERS = ["getDailyCardiovascularAge", "getVo2Max", "getDailyResilience"]
const COLUMNS = ["cardiovascularAge", "vo2Max", "resilienceLevel", "stressSummary"]

describe("the endpoints added from documentation", () => {
  it.each(FETCHERS)("%s reports a document that mapped to nothing", name => {
    const body = oura.slice(oura.indexOf(`export async function ${name}`))
      .slice(0, oura.slice(oura.indexOf(`export async function ${name}`)).indexOf("\n}\n") + 3)
    expect(body, `${name} must call warnIfEmpty — a wrong key cannot fail loudly on its own`)
      .toContain("warnIfEmpty")
  })

  it("names the keys the document actually had, so a wrong guess is fixable", () => {
    expect(oura).toMatch(/Object\.keys\(item\)/)
  })

  it("cannot take the whole sync down when one endpoint is not in the plan", () => {
    expect(sync).toContain("Promise.allSettled")
  })
})

describe("the new columns are read, not just written", () => {
  it.each(COLUMNS)("%s exists in the schema", column => {
    expect(schema).toMatch(new RegExp(`${column}\\s+(Float|String|Int)\\?`))
  })

  it.each(COLUMNS)("the sync writes %s", column => {
    expect(sync).toContain(`${column}:`)
  })

  it.each(COLUMNS)("Emergy can see %s", column => {
    expect(chat).toContain(column)
  })

  it.each(["vo2Max", "cardiovascularAge", "resilienceLevel"])("the Health page shows %s", column => {
    expect(healthPage).toContain(`latestLog.${column}`)
  })
})
