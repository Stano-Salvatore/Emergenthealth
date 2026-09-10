import { describe, it, expect } from "vitest"
import { judgeUpdate, parseVersionCode } from "../app-update"
import { buildFromUserAgent } from "../native/build"

describe("judgeUpdate", () => {
  it("is current on the newest build", () => {
    expect(judgeUpdate(1062, 1062)).toEqual({ status: "current", installed: 1062, latest: 1062 })
  })
  it("is behind on an older build", () => {
    expect(judgeUpdate(1040, 1062)).toEqual({ status: "behind", installed: 1040, latest: 1062 })
  })
  it("treats an unstamped APK as behind — it predates every stamped build", () => {
    expect(judgeUpdate(null, 1062)).toEqual({ status: "behind", installed: null, latest: 1062 })
  })
  it("never claims anything when the latest build is unknown", () => {
    expect(judgeUpdate(1040, null)).toEqual({ status: "unknown-latest", installed: 1040 })
    expect(judgeUpdate(null, null)).toEqual({ status: "unknown-latest", installed: null })
  })
  it("a phone ahead of the release (a local build) is not told to update", () => {
    expect(judgeUpdate(1070, 1062).status).toBe("current")
  })
})

describe("parseVersionCode", () => {
  it("reads the number CI writes into the release notes", () => {
    expect(parseVersionCode("versionCode 1062 · commit abc · built 2026-09-10")).toBe(1062)
  })
  it("is null for notes without one", () => {
    expect(parseVersionCode("first release")).toBeNull()
    expect(parseVersionCode(null)).toBeNull()
  })
})

describe("buildFromUserAgent", () => {
  it("reads the stamped build", () => {
    expect(buildFromUserAgent("Mozilla/5.0 (Linux; Android 14) Emergenthealth-Capacitor EmergenthealthBuild/1062")).toBe(1062)
  })
  it("is null for a shell built before the stamp, and for a browser", () => {
    expect(buildFromUserAgent("Mozilla/5.0 (Linux; Android 14) Emergenthealth-Capacitor")).toBeNull()
    expect(buildFromUserAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/128")).toBeNull()
  })
})
