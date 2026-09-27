import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The weekly review, the anomaly watch and the pattern watch each wrap their
// expensive call in `try { … } catch { continue }`. With the API balance
// empty, every tick of Sunday's review window got a 400 "credit balance too
// low", swallowed it, and the window closed on no review — with no log line
// anywhere to tell "it failed" from "nothing happened this week". A skipped
// user can stay skipped; it cannot stay silent.

const stripped = (file: string): string =>
  readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

const CASES: [file: string, call: string][] = [
  ["src/app/api/cron/emergy-weekly-review/route.ts", "generateWeeklyReview("],
  ["src/app/api/cron/anomaly-watch/route.ts", "scanUserAnomalies("],
  ["src/app/api/cron/correlation-watch/route.ts", "computeCorrelations("],
]

describe("a cron that skips a user after a failure says why", () => {
  for (const [file, call] of CASES) {
    it(`${file.split("/").at(-2)} logs a failed ${call.slice(0, -1)}`, () => {
      const src = stripped(file)
      const at = src.indexOf(call)
      expect(at, `${call} not found in ${file}`).toBeGreaterThan(-1)
      const catchAt = src.indexOf("catch", at)
      const handler = src.slice(catchAt, src.indexOf("}", src.indexOf("{", catchAt)) + 1)
      expect(handler, `the catch after ${call} swallows the error without a log line`).toMatch(/console\.error\(/)
    })
  }
})
