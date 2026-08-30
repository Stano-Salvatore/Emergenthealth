import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

// `npm run build` is `prisma db push --accept-data-loss && next build`, and
// Vercel runs it against production on every deploy. db push makes the database
// match schema.prisma — which means it DROPS tables the schema does not
// declare. Verified locally, twice, against the real table name:
//
//   FcmToken rows before db push: 1
//   FcmToken rows after  db push: ERROR: relation "FcmToken" does not exist
//
// So every table created only by a raw CREATE TABLE IF NOT EXISTS on the
// request path is emptied on every deploy, then silently recreated by the next
// request that needs it. Integration credentials and health logs both.
//
// The fifteen that used to be frozen here were adopted into schema.prisma on
// 2026-08-30, so the debt this set once carried is paid and it is empty. The
// worry that stopped a straight transcription — "the live columns may have
// drifted from the CREATE statements" — turned out to be impossible: the wipe
// itself guaranteed freshness, because every deploy dropped the tables and the
// deployed code's own DDL recreated them. The adoption was transcribed from
// that DDL and verified the only way that counts: seed rows through the raw
// path, run `prisma db push --accept-data-loss`, watch the rows survive, and
// run it again to see "already in sync".
//
// The set stays, empty, because the guard is about the NEXT table: a new raw
// CREATE TABLE IF NOT EXISTS without a matching model is data that will not
// survive its first deploy, and this is what says so before production does.

const KNOWN_RAW_ONLY = new Set<string>([])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p)
  }
  return out
}

function rawCreatedTables(): Set<string> {
  const found = new Set<string>()
  for (const file of walk("src")) {
    if (file.includes("__tests__")) continue
    const src = readFileSync(file, "utf8")
    for (const m of src.matchAll(/CREATE TABLE IF NOT EXISTS\s+"([A-Za-z_][A-Za-z0-9_]*)"/g)) {
      found.add(m[1])
    }
  }
  return found
}

function schemaModels(): Set<string> {
  const schema = readFileSync("prisma/schema.prisma", "utf8")
  return new Set([...schema.matchAll(/^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm)].map(m => m[1]))
}

describe("tables created outside prisma/schema.prisma", () => {
  it("has not grown a new one", () => {
    const declared = schemaModels()
    const rawOnly = [...rawCreatedTables()].filter(t => !declared.has(t)).sort()
    const unexpected = rawOnly.filter(t => !KNOWN_RAW_ONLY.has(t))

    // A new raw table is data that will be dropped on the next deploy, by a
    // build step nobody reads, with no error anywhere. Declare it in the
    // schema instead.
    expect(unexpected).toEqual([])
  })

  it("shrinks the known set when one is adopted", () => {
    // The other direction: once a table IS declared, it must come off this
    // list, or the list stops meaning anything and quietly re-authorises the
    // next one.
    const declared = schemaModels()
    const stillRaw = new Set([...rawCreatedTables()].filter(t => !declared.has(t)))
    const adopted = [...KNOWN_RAW_ONLY].filter(t => !stillRaw.has(t))
    expect(adopted, "adopted into the schema — remove from KNOWN_RAW_ONLY").toEqual([])
  })
})
