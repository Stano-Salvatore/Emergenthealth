import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

// lib/hydration exists because every fluid total once filtered `type ===
// "water"`, so a litre of mate counted as nothing. The fix reached the
// dashboard, the quests and the Week page — and missed three readers: the
// intake overview's own hydration tile (water and sparkling only), the MCP
// daily summary, and the drift report's "drank less alongside" factor. The
// same number read three ways on three screens, which is the bug this
// codebase keeps finding: a sentence measuring one type of row, worded as
// if it measured them all.
//
// A file may write `type: "water"` freely — that is a drink being logged.
// Comparing a row's type to "water" is a READ, and a read has to go through
// lib/hydration.

const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(join(dir, e.name))
    return /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []
  })

const OWN = ["src/lib/hydration.ts"]

// Not a fluid reading: which chat tool a parsed drink is reported as.
const NOT_A_READ = ["src/lib/quick-log-run.ts"]

describe("every hydration total counts every hydrating drink", () => {
  // The first version of this guard let any file that imported lib/hydration
  // compare to "water" as it liked. claude.ts imported it for one sum and
  // filtered `type === "water"` for another, so Emergy was told "Water: 0ml"
  // on a day of sparkling water and tea while the Overview tile said 1.5L.
  // Importing the helper is not using it.
  it("no reader compares a row's type to \"water\"", () => {
    const idiom = /\.type === ["']water["']/
    const readers = walk("src").filter(f => idiom.test(code(f)))
    for (const f of readers) {
      if (OWN.some(o => f.endsWith(o)) || NOT_A_READ.some(o => f.endsWith(o))) continue
      expect.fail(`${f} sums fluid from rows typed "water" alone — tea, coffee and mate count for nothing there. Use lib/hydration.`)
    }
  })

  // The same bug written as a query: the weekly review and the email digest
  // selected `where: { type: "water" }` and reported a week of tea as 0.3L.
  // Writing `type: "water"` is logging a drink and stays free; inside a
  // `where:` it is a read.
  it("no query selects rows typed \"water\" alone", () => {
    const literal = /type:\s*["']water["']\s*[,}]/g
    for (const f of walk("src")) {
      if (OWN.some(o => f.endsWith(o))) continue
      const src = code(f)
      for (const m of src.matchAll(literal)) {
        const before = src.slice(Math.max(0, m.index - 200), m.index)
        const inWhere = /where:\s*\{[^;]*$/.test(before) && !/data:\s*\{[^;]*$/.test(before)
        expect(inWhere, `${f} queries rows typed "water" — use HYDRATING_TYPES and sumHydration`).toBe(false)
      }
    }
  })
})
