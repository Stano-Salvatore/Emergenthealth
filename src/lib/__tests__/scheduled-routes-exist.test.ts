import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync } from "node:fs"

// Every scheduled job must point at a route that exists.
//
// vercel.json scheduled /api/cron/digest for three days after that route was
// deleted. Vercel called it every morning, got a 404, and told nobody: a cron
// that fires into nothing looks exactly like a cron that has nothing to do.
// The only reason it was found is that someone happened to read the file.
//
// The same hazard sits in the Actions workflows, where the endpoint names live
// in a shell loop — a rename on one side and the other keeps curling a URL
// that stopped existing, with `|| true` swallowing the result.
//
// Deleting a route is the normal, correct thing to do. This makes the schedule
// that still calls it fail the build instead of failing quietly at 8am.

const problems: string[] = []

function check(name: string, where: string) {
  const route = `src/app/api/cron/${name}/route.ts`
  if (!existsSync(route)) {
    problems.push(`${where}: /api/cron/${name} — no route at ${route}`)
  } else if (!/export async function GET\b/.test(readFileSync(route, "utf8"))) {
    // Schedulers issue GET; a route that only exports POST answers 405.
    problems.push(`${where}: /api/cron/${name} — ${route} does not export GET`)
  }
}

describe("scheduled jobs point at routes that exist", () => {
  it("checks vercel.json and the Actions workflows", () => {
    problems.length = 0

    const crons: { path?: string }[] = JSON.parse(readFileSync("vercel.json", "utf8")).crons ?? []
    for (const cron of crons) {
      const m = /^\/api\/cron\/([\w-]+)$/.exec(cron.path ?? "")
      if (!m) { problems.push(`vercel.json: unexpected cron path ${cron.path}`); continue }
      check(m[1], "vercel.json")
    }

    for (const file of readdirSync(".github/workflows")) {
      const src = readFileSync(`.github/workflows/${file}`, "utf8")
      if (!src.includes("/api/cron/")) continue
      // The endpoint names live in `for name in a b c; do … /api/cron/${name}`.
      // Only loops whose variable is actually used in a cron URL are read, so
      // an unrelated shell loop in the same workflow is not mistaken for one.
      for (const loop of src.matchAll(/for\s+(\w+)\s+in\s+([^;]+);\s*do/g)) {
        if (!new RegExp(`/api/cron/\\$\\{${loop[1]}\\}`).test(src)) continue
        for (const name of loop[2].trim().split(/\s+/)) check(name, `.github/workflows/${file}`)
      }
    }

    expect(problems, [
      "A schedule calls a cron route that isn't there.",
      "",
      "Either restore the route or remove it from the schedule — a cron firing",
      "into a 404 reports nothing and looks identical to one with no work to do.",
    ].join("\n")).toEqual([])
  })
})
