import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// A self-hosted server runs the daily jobs from docker/selfhost/crontab, not
// from vercel.json. Two lists of the same thing drift: a job added to
// vercel.json would run on Vercel and silently never run at home. This keeps
// them the same list.

const vercel: { path: string; schedule: string }[] =
  JSON.parse(readFileSync("vercel.json", "utf8")).crons

const selfhost = readFileSync("docker/selfhost/crontab", "utf8")
  .split("\n")
  .map(l => l.trim())
  .filter(l => l && !l.startsWith("#"))
  .map(l => {
    const f = l.split(/\s+/)
    return { schedule: f.slice(0, 5).join(" "), path: f[5] }
  })

const key = (c: { path: string; schedule: string }) => `${c.schedule} ${c.path}`

describe("the self-hosted crontab", () => {
  it("runs exactly the jobs vercel.json runs, on the same schedule", () => {
    expect(selfhost.map(key).sort()).toEqual(vercel.map(key).sort())
  })

  it("only calls cron routes, each of which checks CRON_SECRET", () => {
    for (const { path } of selfhost) {
      expect(path).toMatch(/^\/api\/cron\/[a-z-]+$/)
      const route = readFileSync(`src/app${path}/route.ts`, "utf8")
      expect(route, path).toMatch(/requireCronSecret|bearerMatches/)
    }
  })
})
