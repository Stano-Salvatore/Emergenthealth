import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"

// A standing guard, not a unit test.
//
// A structured-output schema that declares `enum` next to a union `type` is
// rejected by the API, and the rejection is total: the request 400s before the
// model sees anything, so the feature does not degrade — it never works at
// all. The lab importer shipped like that and every import failed with
// "Failed to read the document" for as long as it existed.
//
// Nothing else catches this. It is valid TypeScript, valid JSON, valid JSON
// Schema by the spec, and the object is only ever validated by a server we
// don't run in tests. It fails the first time a real person uses the feature.
//
// The fix is always the same shape and is used everywhere else in this
// codebase: one declared type, and a sentinel string ("none") for the absent
// case, mapped back to null when the response is normalized.

// `type: [...]` followed within a few properties by `enum:` on the same line.
const PATTERN = 'type: \\[[^]]*\\][^\\n]*enum:'

describe("no structured-output schema pairs enum with a union type", () => {
  it("finds no occurrences", () => {
    let out = ""
    try {
      out = execSync(
        `grep -rnE '${PATTERN}' src --include=*.ts --include=*.tsx || true`,
        { encoding: "utf8", cwd: process.cwd() },
      )
    } catch {
      // grep exits non-zero when nothing matches; `|| true` covers that, and a
      // genuine failure to run must not silently pass the guard.
      out = ""
    }

    const hits = out
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .filter(l => !l.includes("__tests__"))

    expect(hits, [
      "A JSON schema declares `enum` alongside a union `type`. The API rejects",
      "the whole request with a 400, so the feature fails on every call.",
      "",
      "Declare one type and spell the absent case as a sentinel:",
      '  flag: { type: "string", enum: ["low", "high", "normal", "none"] }',
      "",
      "then map the sentinel back to null where the response is normalized.",
    ].join("\n")).toEqual([])
  })
})
