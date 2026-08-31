import { describe, it, expect } from "vitest"
import { swipeAction } from "@/lib/calendar-nav"

describe("swipeAction", () => {
  it("pages forward on a decisive left swipe", () => {
    expect(swipeAction(-120, 10)).toBe("next")
  })

  it("pages back on a decisive right swipe", () => {
    expect(swipeAction(120, -10)).toBe("prev")
  })

  it("ignores a drag that doesn't clear the distance threshold", () => {
    expect(swipeAction(-40, 0)).toBeNull()
    expect(swipeAction(55, 0)).toBeNull()
  })

  it("ignores a mostly-vertical drag — that's a scroll, not a page turn", () => {
    // Long horizontal travel, but the finger moved even further down.
    expect(swipeAction(-80, 200)).toBeNull()
    expect(swipeAction(70, -120)).toBeNull()
  })

  it("still fires on a gentle diagonal that stays clearly horizontal", () => {
    // 100 across, 40 down: past threshold and > 1.5× the vertical travel.
    expect(swipeAction(-100, 40)).toBe("next")
  })

  it("honours a custom threshold", () => {
    expect(swipeAction(-70, 0, 100)).toBeNull()
    expect(swipeAction(-120, 0, 100)).toBe("next")
  })
})
