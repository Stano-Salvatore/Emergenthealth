import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"

// The phone's night reaches the server on foreground, and the brief asks for
// "last night" on mount. Those two races. The dashboard layout mounts the
// brief inside the page and NativeBridge after it, so React runs the brief's
// effect first: every cold open asked the server before the drain had even
// begun, and a "no sleep data" answer was cached for the rest of the morning.
// The production trace on 24 Sept: POST /api/phone/sensors at 06:12:58,
// GET /api/briefing at 06:12:59, brief says "No sleep data came through".
//
// Two halves. The client waits — briefly, bounded — for the drain before it
// asks. And the server, when it holds a sleepless brief in cache, checks the
// phone's table as well as the ring's before serving it again.

const stripped = (file: string): string =>
  readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

describe("the brief asks the server only after the phone has been drained", () => {
  it("DailyBriefing awaits waitForPhoneDrain before fetching /api/briefing", () => {
    const src = stripped("src/components/dashboard/DailyBriefing.tsx")
    const effect = src.slice(src.indexOf("useEffect("), src.indexOf("}, [])"))
    const wait = effect.indexOf("await waitForPhoneDrain(")
    const ask = effect.indexOf("loadBriefing(")
    expect(wait, "The mount effect in DailyBriefing no longer waits for the phone drain before asking for the brief.").toBeGreaterThan(-1)
    expect(ask, "The mount effect in DailyBriefing no longer loads the brief.").toBeGreaterThan(-1)
    expect(
      wait < ask,
      "The wait sits after the load, which is no wait at all — the brief is generated before the phone's night lands.",
    ).toBe(true)
  })

  it("NativeBridge drains through the helper that the brief waits on", () => {
    const bridge = stripped("src/components/NativeBridge.tsx")
    expect(
      bridge,
      "NativeBridge drains the phone some other way than drainPhone() from phone-uploads, so waitForPhoneDrain " +
        "has nothing to wait on and resolves at once.",
    ).toMatch(/drainPhone\(\)/)
    expect(bridge).not.toMatch(/uploadPhoneSensors\(|uploadActivityEvents\(/)
  })

  it("a cached sleepless brief is re-checked against the phone's table, not only the ring's", () => {
    const brief = stripped("src/app/api/briefing/route.ts")
    const serve = brief.indexOf("staleButServable = ")
    const phone = brief.slice(0, serve).indexOf("phoneSleepSegment")
    expect(
      phone,
      "The cache check regenerates a \"no sleep\" brief only when a ring row lands. A phone night that arrives " +
        "a second after the brief was generated is then ignored until the period changes.",
    ).toBeGreaterThan(-1)
  })

  it("the sensors route says what it received, so a night that never arrived can be told from one that did", () => {
    const route = stripped("src/app/api/phone/sensors/route.ts")
    expect(route).toMatch(/console\.(log|info)\(\s*`\[phone-sensors\]/)
  })
})

const phone = vi.hoisted(() => ({ native: false, sensors: vi.fn(), events: vi.fn() }))
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => phone.native },
  registerPlugin: () => ({}),
}))
vi.mock("@/lib/native/bubble", () => ({
  sampleAmbient: async () => {},
  drainSensorData: () => phone.sensors(),
  drainActivityEvents: () => phone.events(),
}))

describe("waitForPhoneDrain", () => {
  const drains = phone

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    phone.native = false
    drains.sensors.mockReset().mockResolvedValue({ ambient: [], phoneEvents: [], sleep: [] })
    drains.events.mockReset().mockResolvedValue([])
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const load = () => import("@/lib/native/phone-uploads")

  it("is immediate on the web, where there is nothing to drain", async () => {
    const { waitForPhoneDrain } = await load()
    let done = false
    void waitForPhoneDrain(5000).then(() => { done = true })
    await Promise.resolve(); await Promise.resolve()
    expect(done).toBe(true)
  })

  it("on the phone, holds the brief until a drain that starts later has finished", async () => {
    phone.native = true
    let release!: () => void
    drains.sensors.mockReturnValue(new Promise(r => { release = () => r({ ambient: [], phoneEvents: [], sleep: [{ start: 1, end: 2, status: 0 }] }) }))
    const { waitForPhoneDrain, drainPhone } = await load()
    let done = false
    void waitForPhoneDrain(5000).then(() => { done = true })
    await vi.advanceTimersByTimeAsync(10)
    expect(done, "resolved with no drain registered").toBe(false)
    void drainPhone()
    await vi.advanceTimersByTimeAsync(10)
    expect(done, "resolved before the drain's POST finished").toBe(false)
    release()
    await vi.advanceTimersByTimeAsync(10)
    expect(done).toBe(true)
    expect(fetch).toHaveBeenCalledWith("/api/phone/sensors", expect.anything())
  })

  it("on the phone, gives up after the timeout so a broken plugin cannot hide the brief", async () => {
    phone.native = true
    drains.sensors.mockReturnValue(new Promise(() => {}))
    const { waitForPhoneDrain, drainPhone } = await load()
    void drainPhone()
    let done = false
    void waitForPhoneDrain(3000).then(() => { done = true })
    await vi.advanceTimersByTimeAsync(2999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(done).toBe(true)
  })

  it("does not wait again once a drain has completed", async () => {
    phone.native = true
    const { waitForPhoneDrain, drainPhone } = await load()
    await drainPhone()
    let done = false
    void waitForPhoneDrain(5000).then(() => { done = true })
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })
})
