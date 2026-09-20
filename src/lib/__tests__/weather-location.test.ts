import { describe, it, expect, vi, beforeEach } from "vitest"

const rows = vi.hoisted(() => ({ value: [] as { key: string; value: string }[] }))
vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn(() => Promise.resolve(rows.value)) },
}))

import { getWeatherCoords } from "@/lib/weather-location"

const stored = (lat: string, lon: string) => {
  rows.value = [{ key: "weather_lat", value: lat }, { key: "weather_lon", value: lon }]
}

beforeEach(() => { rows.value = [] })

// It used to return Bratislava for anyone who had not set a location. For one
// account that was invisible and right; for every other it meant the Brief
// opened on a confident hourly forecast for a city they had never been to,
// under an outfit line telling them to wear a t-shirt. The nightly weather
// cron states the rule this broke: no row rather than a guessed city.
describe("no location means no weather, not somebody else's", () => {
  it("says nothing when nothing is stored", async () => {
    expect(await getWeatherCoords("u")).toBeNull()
  })

  it("returns what the user actually set", async () => {
    stored("52.52", "13.405")
    expect(await getWeatherCoords("u")).toEqual({ lat: 52.52, lon: 13.405, tz: "auto" })
  })

  it("treats a blank preference as unset, not as the Gulf of Guinea", async () => {
    // `Number("")` is 0, and 0 is finite. Checked on the string for that
    // reason: (0, 0) is a real place and a worse guess than the old one.
    stored("", "")
    expect(await getWeatherCoords("u")).toBeNull()
    stored("  ", "13.405")
    expect(await getWeatherCoords("u")).toBeNull()
  })

  it("refuses half a pair", async () => {
    rows.value = [{ key: "weather_lat", value: "52.52" }]
    expect(await getWeatherCoords("u")).toBeNull()
  })

  it("refuses coordinates that are not on Earth", async () => {
    stored("952.52", "13.405")
    expect(await getWeatherCoords("u")).toBeNull()
    stored("52.52", "-999")
    expect(await getWeatherCoords("u")).toBeNull()
  })

  it("still allows the one real place that looks like a bug", async () => {
    // Null Island is 0,0 — genuinely at sea, but a user who deliberately
    // stored it gets what they stored. The emptiness test above is what
    // separates this from a blank.
    stored("0", "0")
    expect(await getWeatherCoords("u")).toEqual({ lat: 0, lon: 0, tz: "auto" })
  })
})
