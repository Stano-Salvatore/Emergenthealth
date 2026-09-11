import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

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

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const FETCHERS = ["getDailyCardiovascularAge", "getVo2Max", "getDailyResilience"]

// ─── The list is derived, not typed out ───────────────────────────────────────
//
// It used to be four names written by hand — and five columns shipped in the
// pull request that added it. `pulseWaveVelocity` was fetched, stored on every
// sync, and read by absolutely nothing: the exact bug this file exists to
// catch, missed because the guard's own list was maintained the same way as
// the code it was guarding.
//
// Every HealthLog column the sync writes is the list now, read off the schema.
// A column added tomorrow is covered the moment it is written.

const HEALTH_LOG_COLUMNS: string[] = (() => {
  const model = /model HealthLog \{([\s\S]*?)\n\}/.exec(schema)
  if (!model) throw new Error("HealthLog not found in prisma/schema.prisma")
  const skip = new Set(["id", "userId", "user", "date", "syncedAt", "createdAt", "updatedAt"])
  return model[1]
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"))
    .map(l => l.split(/\s+/)[0])
    .filter(c => /^[a-zA-Z][a-zA-Z0-9]*$/.test(c) && !skip.has(c))
})()

/** The subset the sync actually writes. Whole-word, so `spo2` never matches `spo2Data`. */
const COLUMNS = HEALTH_LOG_COLUMNS.filter(c => new RegExp(`\\b${c}:\\s`).test(sync))

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

describe("every column the sync writes is read by something", () => {
  it("found the columns to check", () => {
    // A pattern that quietly matched nothing would turn this file green while
    // checking nothing at all, which is worse than the bug it replaced.
    expect(HEALTH_LOG_COLUMNS.length).toBeGreaterThan(20)
    expect(COLUMNS.length).toBeGreaterThan(15)
    expect(COLUMNS).toContain("pulseWaveVelocity")
    expect(COLUMNS).toContain("sleepLatency")
  })

  /** Anywhere a stored figure can be read — the app, not the sync that wrote it. */
  const WRITERS = new Set(["src/lib/oura-sync.ts", "src/lib/oura.ts"])
  const readers = sourceFiles("src")
    .filter(f => !WRITERS.has(f) && !f.includes("__tests__"))
    .map(f => [f, readFileSync(f, "utf8")] as const)

  it.each(COLUMNS)("%s is read somewhere", column => {
    const pattern = new RegExp(`\\b${column}\\b`)
    const seen = readers.filter(([, src]) => pattern.test(src))
    expect(seen.length,
      `${column} is written on every sync and read by nothing. Surface it, or stop fetching it.`)
      .toBeGreaterThan(0)
  })
})

describe("the long-range Oura figures reach both surfaces", () => {
  // Each updates on its own cadence, so they render only on the days Oura
  // published one — but "renders rarely" and "is never read" are different
  // things, and only the second is a bug.
  const SLOW = ["vo2Max", "cardiovascularAge", "pulseWaveVelocity", "resilienceLevel"]

  it.each(SLOW)("Emergy can see %s", column => {
    expect(chat).toContain(column)
  })

  it.each(SLOW)("the Health page shows %s", column => {
    expect(healthPage).toContain(`latestLog.${column}`)
  })

  it("and selects them, or the page renders nothing", () => {
    // Reading `latestLog.x` without selecting `x` is a type error today. The
    // select is still a hand-written list beside a hand-written block of JSX,
    // and those have drifted here before.
    for (const column of SLOW) {
      expect(healthPage, `${column} is rendered but never selected`).toContain(`${column}: true`)
    }
  })
})
