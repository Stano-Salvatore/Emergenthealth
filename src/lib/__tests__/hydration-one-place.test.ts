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

describe("every hydration total counts every hydrating drink", () => {
  it("no reader compares a row's type to \"water\" without going through lib/hydration", () => {
    const idiom = /\.type === ["']water["']/
    const readers = walk("src").filter(f => idiom.test(code(f)))
    for (const f of readers) {
      if (OWN.some(o => f.endsWith(o))) continue
      expect(code(f), `${f} sums fluid from rows typed "water" alone — tea, coffee and mate count for nothing there`)
        .toMatch(/from "@\/lib\/hydration"/)
    }
  })
})
