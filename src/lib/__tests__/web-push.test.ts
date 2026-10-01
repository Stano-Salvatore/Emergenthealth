import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { iosNeedsHomeScreen } from "@/lib/web-push"

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1"
const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36"

describe("iosNeedsHomeScreen", () => {
  it("an iPhone in a Safari tab has to add the app to the Home Screen first", () => {
    expect(iosNeedsHomeScreen({ ua: IPHONE, standalone: false, maxTouchPoints: 5 })).toBe(true)
  })

  it("an iPhone already opened from the Home Screen does not", () => {
    expect(iosNeedsHomeScreen({ ua: IPHONE, standalone: true, maxTouchPoints: 5 })).toBe(false)
  })

  it("an iPad that asks for the desktop site is still iOS", () => {
    expect(iosNeedsHomeScreen({ ua: IPAD_DESKTOP_UA, standalone: false, maxTouchPoints: 5 })).toBe(true)
    // a real Mac has no touch points
    expect(iosNeedsHomeScreen({ ua: IPAD_DESKTOP_UA, standalone: false, maxTouchPoints: 0 })).toBe(false)
  })

  it("Android never needs it — Chrome pushes from a tab", () => {
    expect(iosNeedsHomeScreen({ ua: ANDROID, standalone: false, maxTouchPoints: 5 })).toBe(false)
  })
})

describe("wiring", () => {
  const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

  it("onboarding's Enable registers the phone for pushes, not only the permission", () => {
    expect(strip("src/app/onboarding/page.tsx")).toMatch(/subscribeWebPush\(/)
  })

  it("one subscribe path: settings, Emergy's panel and onboarding share it", () => {
    for (const f of ["src/components/settings/PushNotifications.tsx", "src/components/emergy/EmergyPanel.tsx"]) {
      const src = strip(f)
      expect(src, f).toMatch(/subscribeWebPush\(/)
      expect(src, f).not.toMatch(/pushManager\.subscribe\(/)
      expect(src, f).not.toMatch(/function urlBase64ToUint8Array/)
    }
  })

  it("an iPhone in a Safari tab is told how to get notifications instead of seeing nothing", () => {
    expect(strip("src/components/settings/PushNotifications.tsx")).toMatch(/iosNeedsHomeScreen\(/)
    expect(strip("src/app/onboarding/page.tsx")).toMatch(/iosNeedsHomeScreen\(/)
  })
})
