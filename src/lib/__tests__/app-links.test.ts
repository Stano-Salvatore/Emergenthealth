import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { APP_LINKS, linkFor, withLink, linkPromptList } from "@/lib/app-links"

describe("APP_LINKS", () => {
  it("every link lands on a real page, and a tab link on a tab that page has", () => {
    for (const l of APP_LINKS) {
      const [path, query] = l.path.split("?")
      const file = `src/app${path}/page.tsx`
      expect(existsSync(file), `${l.path}: no ${file}`).toBe(true)
      const tab = query ? new URLSearchParams(query).get("tab") : null
      if (tab) expect(readFileSync(file, "utf8"), `${l.path}: no "${tab}" tab`).toContain(`"${tab}"`)
    }
  })

  it("never points at a route the proxy redirects — the button should land where it says", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8")
    const merged = /const MERGED_ROUTES[^{]*{([\s\S]*?)\n}/.exec(proxy)![1]
    for (const l of APP_LINKS) expect(merged, l.path).not.toContain(`"${l.path}":`)
  })

  it("has one label per path and no duplicates", () => {
    expect(new Set(APP_LINKS.map(l => l.path)).size).toBe(APP_LINKS.length)
  })
})

describe("withLink", () => {
  it("appends a tappable markdown link for a known page", () => {
    expect(withLink("Your 08:00 Elicea isn't logged yet.", "/dashboard/intake?tab=meds"))
      .toBe("Your 08:00 Elicea isn't logged yet. [Medications](/dashboard/intake?tab=meds)")
  })

  it("adds nothing for the chat itself, an unknown path or no path", () => {
    expect(withLink("Hi.", "/dashboard/chat")).toBe("Hi.")
    expect(withLink("Hi.", "/dashboard/nowhere")).toBe("Hi.")
    expect(withLink("Hi.", undefined)).toBe("Hi.")
  })

  it("an old merged route still finds its page's label", () => {
    expect(linkFor("/dashboard/medications")?.path).toBe("/dashboard/intake?tab=meds")
  })
})

describe("linkPromptList", () => {
  it("lists every path once, so the prompt and the links can never disagree", () => {
    const list = linkPromptList()
    for (const l of APP_LINKS) expect(list).toContain(l.path)
  })

  it("is what the system prompt uses", () => {
    const src = readFileSync("src/lib/claude.ts", "utf8")
    expect(src).toMatch(/linkPromptList\(\)/)
    expect(src).not.toMatch(/Use ONLY these paths: \/dashboard \(home\)/)
  })
})

describe("proactive messages carry their page", () => {
  const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  it.each([
    "src/app/api/cron/anomaly-watch/route.ts",
    "src/app/api/cron/correlation-watch/route.ts",
    "src/app/api/cron/emergy-push/route.ts",
    "src/app/api/cron/emergy-weekly-review/route.ts",
    "src/app/api/cron/evening-reminder/route.ts",
    "src/app/api/cron/quiet-source/route.ts",
    "src/app/api/cron/med-reminders/route.ts",
  ])("%s", f => {
    expect(strip(f)).toMatch(/sayAsEmergy\([^)]*\{\s*link:/)
  })
})
