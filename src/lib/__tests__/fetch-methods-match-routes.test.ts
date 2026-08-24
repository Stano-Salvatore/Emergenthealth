import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"

// Every fetch to our own API must use a method that route actually exports.
//
// AutoSync posted to /api/sync/calendar on every app open. That route exports
// only GET, so it answered 405 every single time, and the call sat inside a
// Promise.allSettled that reads no statuses — so it failed for months without
// anything, anywhere, saying so. Production logs found it, not the build.
//
// Nothing else can catch this: the client and the route are separate modules
// with no shared type between them, so a wrong method is invisible to tsc and
// to every test that doesn't make the request. This checks the pairing.
//
// Only string-literal paths are checked. A template literal with a variable in
// it cannot be resolved to a route file here, and guessing would be worse than
// admitting the gap.

/** The source span of the fetch(...) call whose name starts at `start`. */
function callSpan(src: string, start: number): string {
  const open = src.indexOf("(", start)
  if (open < 0) return ""
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === "(") depth++
    else if (c === ")") {
      depth--
      // Bounded to this call's own arguments. Reading past the closing paren
      // picks up the next helper's `method:` and invents a mismatch.
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return ""
}

describe("client fetches match the routes they call", () => {
  it("finds no method the route does not export", () => {
    let list = ""
    try {
      list = execSync(
        `grep -rl 'fetch("/api/' src --include=*.ts --include=*.tsx || true`,
        { encoding: "utf8", cwd: process.cwd() },
      )
    } catch {
      list = ""
    }

    const problems: string[] = []
    for (const file of list.split("\n").map(s => s.trim()).filter(Boolean)) {
      if (file.includes("__tests__")) continue
      const src = readFileSync(file, "utf8")
      const re = /fetch\(\s*"(\/api\/[^"`$]*)"/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        const path = m[1].split("?")[0].replace(/\/$/, "")
        const span = callSpan(src, m.index + "fetch".length)
        const method = /method:\s*"([A-Z]+)"/.exec(span)?.[1] ?? "GET"
        const route = `src/app${path}/route.ts`
        if (!existsSync(route)) {
          // A dynamic segment ([id]) can't be matched by path alone; only
          // report a missing file when no dynamic sibling could explain it.
          if (!existsSync(`src/app${path.split("/").slice(0, -1).join("/")}`)) continue
          problems.push(`${file}: ${method} ${path} — no route file at ${route}`)
          continue
        }
        if (!new RegExp(`export async function ${method}\\b`).test(readFileSync(route, "utf8"))) {
          problems.push(`${file}: ${method} ${path} — ${route} does not export ${method}`)
        }
      }
    }

    expect(problems, [
      "A fetch uses a method its route does not export. At runtime that is a",
      "405 the caller usually never checks.",
      "",
      "Either use the method the route exports, or add the handler to it.",
    ].join("\n")).toEqual([])
  })
})
