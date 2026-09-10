import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"

// Postgres reports identifiers from information_schema and pg_catalog as its
// `name` type, and Prisma 7's driver adapter will not deserialize that type:
// "Failed to deserialize column of type 'name'". The full-account backup
// selected `table_name` bare, and every export — the download and the
// monthly email — failed on that first query for eleven days. Nothing said
// so: the link just did nothing.
//
// Any identifier column read from a catalog view must be cast to text in the
// SELECT list. This finds the next one before production does.

describe("catalog identifier columns are cast to text", () => {
  it("every information_schema / pg_catalog query casts what it selects", () => {
    let files = ""
    try {
      files = execSync(
        `grep -rlE 'information_schema|pg_catalog|pg_tables|pg_class' src --include=*.ts --include=*.tsx || true`,
        { encoding: "utf8", cwd: process.cwd() },
      )
    } catch { files = "" }
    const problems: string[] = []
    for (const file of files.split("\n").map(f => f.trim()).filter(Boolean)) {
      if (file.includes("__tests__")) continue
      const src = readFileSync(file, "utf8")
      // Each SELECT … FROM information_schema/pg_ block, judged on its own list.
      for (const m of src.matchAll(/SELECT\s+([\s\S]*?)\s+FROM\s+(information_schema|pg_catalog|pg_tables|pg_class)/gi)) {
        const list = m[1]
        const bare = list.match(/\b(table_name|column_name|table_schema|relname|attname|nspname)\b(?!\s*::text)/gi)
        // A bare identifier is fine as long as that same column is cast somewhere in the list.
        const offending = (bare ?? []).filter(col => !new RegExp(`${col}\\s*::text`, "i").test(list))
        if (offending.length) problems.push(`${file}: SELECT ${list.trim().replace(/\s+/g, " ")} — cast ${[...new Set(offending)].join(", ")} to ::text`)
      }
    }
    expect(problems, [
      "A catalog query selects a Postgres `name`-typed identifier without ::text.",
      "Prisma's driver adapter cannot deserialize that type, and the query fails at runtime.",
    ].join("\n")).toEqual([])
  })
})
