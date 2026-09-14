import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { NAV_ITEMS } from "@/lib/nav-items"

// The four tabs beside Emergy, and the one rule that makes them dangerous to
// edit.
//
// Below `lg` the bottom nav is the whole of navigation and the sidebar is a
// drawer. A page pinned in the bottom nav is hidden from that drawer as a
// duplicate — so the two files have to agree, and they agree only by hand.
// Move a tab out of BottomNav and forget Sidebar's IN_BOTTOM_NAV and the page
// is not demoted, it is GONE on a phone: no tab, and no drawer row either.
//
// That is what these guard. Check-in was the page that made the risk concrete:
// it held a permanent slot for a once-a-day wizard while logging a drink — the
// thing done all day — had no front door at all.

const bottomNav = readFileSync("src/components/layout/BottomNav.tsx", "utf8")
const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8")

/** Every destination the bottom nav links to, Emergy in the middle included. */
const navHrefs = [
  ...[...bottomNav.matchAll(/\bhref: "([^"]+)"/g)].map(m => m[1]),
  ...[...bottomNav.matchAll(/\bhref="([^"]+)"/g)].map(m => m[1]),
]
/** The sidebar hides these as duplicates of a tab. */
const pinned = new Set(
  [...(sidebar.match(/const IN_BOTTOM_NAV = new Set\(\[[^\]]*\]/)?.[0] ?? "")
    .matchAll(/"([^"]+)"/g)].map(m => m[1])
)
const path = (href: string) => href.split("?")[0]

describe("the five things a phone can reach without opening the drawer", () => {
  it("links to exactly these, and Overview is the only one listed twice", () => {
    expect(new Set(navHrefs.map(path))).toEqual(new Set([
      "/dashboard",
      "/dashboard/intake",
      "/dashboard/chat",
      "/dashboard/habits",
      "/dashboard/settings",
    ]))
    // Overview is deliberately absent from IN_BOTTOM_NAV — it is non-hideable
    // and shows in the drawer too. Every other tab is pinned, or it appears
    // twice on one screen.
    expect(pinned).toEqual(new Set(navHrefs.map(path).filter(p => p !== "/dashboard")))
  })

  it("pins nothing the bottom nav no longer carries", () => {
    // The failure this exists for, stated as an assertion. A pinned page with
    // no tab is hidden from the drawer in favour of a tab that isn't there.
    for (const href of pinned) {
      expect(navHrefs.map(path), `${href} is hidden from the drawer as a duplicate of a tab that no longer exists`)
        .toContain(href)
    }
  })

  it("every tab has a row in the shared manifest", () => {
    // lg and up there is no bottom nav, so the sidebar is the only way to
    // these — and it renders from nav-items, not from this file.
    for (const href of new Set(navHrefs.map(path))) {
      expect(NAV_ITEMS.map(i => i.href), `${href} is a tab with no sidebar row above lg`)
        .toContain(href)
    }
  })
})

describe("Log opens where the logging is", () => {
  it("lands on the chips rather than the summary", () => {
    // /dashboard/intake greets you with four read-only progress bars, and the
    // tab holding the one-tap chips is fourth of five — off-screen at 390px.
    // Landing on the default tab would keep the taps and only move them.
    expect(bottomNav, "Log must open the Intake tab, not the page's default")
      .toContain('href: "/dashboard/intake?tab=intake"')
  })

  it("lights up on the page it just opened", () => {
    // usePathname() drops the query, so matching the raw href would leave the
    // tab unlit on its own destination — the one place it must be lit.
    expect(bottomNav).toContain('const path = href.split("?")[0]')
    expect(bottomNav, "an href with a query can never equal a pathname")
      .not.toMatch(/pathname === href/)
  })
})

describe("Check-in kept a way in", () => {
  it("still has a sidebar row", () => {
    expect(NAV_ITEMS.map(i => i.href)).toContain("/dashboard/checkin")
  })

  it("is no longer hidden from the drawer", () => {
    // It was pinned while it held a tab. Losing the tab without losing the pin
    // is precisely how a page disappears from a phone.
    expect(pinned).not.toContain("/dashboard/checkin")
  })
})
