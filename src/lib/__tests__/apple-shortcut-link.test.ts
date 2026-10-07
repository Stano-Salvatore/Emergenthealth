import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { connectShortcutUrl, readyShortcutUrl, runShortcutUrl } from "@/lib/apple-shortcut"

// Building the shortcut by hand is the hard part of connecting an iPhone.
// Once one person has built it, they share it as an iCloud link, and
// APPLE_SHORTCUT_URL puts "Add the shortcut" and "Connect" on everyone's card:
// Connect hands the key to the shortcut, nothing to paste. Only an iCloud
// shortcut link is ever offered — whatever else is in the variable, the
// button does not appear.

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

  it("Connect runs the shortcut by name with the key as its input", () => {
    expect(runShortcutUrl()).toBe("shortcuts://run-shortcut?name=Emergenthealth")
    const href = connectShortcutUrl("ah_abc-DEF_123")
    expect(href).toBe("shortcuts://run-shortcut?name=Emergenthealth&input=text&text=ah_abc-DEF_123")
    // A key is base64url, but the URL is built to survive anything.
    expect(new URL(connectShortcutUrl("ah_a&b=c d")).searchParams.get("text")).toBe("ah_a&b=c d")
  })

  it("Settings and onboarding hand it to the quick setup, and the card says how to share one safely", () => {
    expect(readFileSync("src/app/dashboard/settings/page.tsx", "utf8")).toMatch(/<AppleHealthManager shortcutUrl=\{readyShortcutUrl\(\)\} \/>/)
    expect(readFileSync("src/app/onboarding/page.tsx", "utf8")).toMatch(/shortcutUrl=\{readyShortcutUrl\(\)\}/)
    expect(readFileSync("src/app/onboarding/OnboardingWizard.tsx", "utf8")).toMatch(/<AppleHealthQuickSetupStandalone shortcutUrl=\{shortcutUrl\} \/>/)
    const quick = readFileSync("src/components/settings/AppleHealthQuickSetup.tsx", "utf8")
    expect(quick).toMatch(/Add the shortcut/)
    expect(quick).toMatch(/connectShortcutUrl\(data\.key\)/)
    const card = readFileSync("src/components/settings/AppleHealthManager.tsx", "utf8")
    expect(card).toMatch(/<AppleHealthQuickSetup shortcutUrl=\{shortcutUrl\}/)
    // The shared copy keeps the key it's handed in a file, never the sharer's own.
    expect(card).toMatch(/Emergenthealth\/key\.txt/)
    expect(card).toMatch(/must not stay in it/)
  })
})
