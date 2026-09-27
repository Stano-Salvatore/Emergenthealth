import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// Three caffeine ceilings and none of them the user's. Settings has a
// "Caffeine max"; /api/caffeine reads it and sends it as limitMg. Then the
// Body tab drew its bar against a hard-coded 400 ("320 / 400 mg", not red),
// and the Overview against a weight-based 340 — so someone who had set 300
// and drunk 320 saw nothing that said 300 anywhere.

const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

describe("the caffeine ceiling is the one set in Settings", () => {
  it("the Body tab's bar and its labels are drawn against limitMg", () => {
    const page = code("src/app/dashboard/caffeine/page.tsx")
    const cards = page.slice(page.indexOf("export function CaffeineStatusCards"), page.indexOf("export function CaffeineLogTools"))
    expect(cards).toMatch(/data\.limitMg/)
    // LIMIT_MG may stand in only when the API sent nothing usable.
    expect(cards.match(/LIMIT_MG/g) ?? []).toHaveLength(1)
    expect(cards).not.toMatch(/>\s*200 mg|>\s*350 mg/)
  })

  it("the Overview honours the Settings ceiling when it is the lower one", () => {
    const tab = code("src/components/intake/OverviewTab.tsx")
    expect(tab).toMatch(/Math\.min\(goals\.coffeeMax, t\.caffeineMaxMg\)/)
    expect(tab).not.toMatch(/goal=\{t\.caffeineMaxMg\}/)
  })
})
