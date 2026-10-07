import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { readyShortcutUrl } from "@/lib/apple-shortcut"

// Building the shortcut by hand is the hard part of connecting an iPhone.
// Once one person has built it, they share it as an iCloud link, and
// APPLE_SHORTCUT_URL puts a "Get the shortcut" button on everyone's card:
// tap, paste the key, done. Only an iCloud shortcut link is ever offered —
// whatever else is in the variable, the button does not appear.

const saved = process.env.APPLE_SHORTCUT_URL
afterEach(() => { process.env.APPLE_SHORTCUT_URL = saved })

describe("the ready-made shortcut link", () => {
  it("an iCloud shortcut link is offered", () => {
    process.env.APPLE_SHORTCUT_URL = " https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef "
    expect(readyShortcutUrl()).toBe("https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef")
  })

  it("anything else is not", () => {
    for (const v of ["", "http://www.icloud.com/shortcuts/abc", "https://evil.example/shortcuts/abc", "https://www.icloud.com.evil.example/shortcuts/abc", "javascript:alert(1)"]) {
      process.env.APPLE_SHORTCUT_URL = v
      expect(readyShortcutUrl()).toBeNull()
    }
    delete process.env.APPLE_SHORTCUT_URL
    expect(readyShortcutUrl()).toBeNull()
  })

  it("Settings hands it to the card, and the card says how to share one safely", () => {
    expect(readFileSync("src/app/dashboard/settings/page.tsx", "utf8")).toMatch(/<AppleHealthManager shortcutUrl=\{readyShortcutUrl\(\)\} \/>/)
    const card = readFileSync("src/components/settings/AppleHealthManager.tsx", "utf8")
    expect(card).toMatch(/Get the shortcut/)
    expect(card).toMatch(/Import Question/)
    expect(card).toMatch(/PASTE_YOUR_KEY/)
  })
})
