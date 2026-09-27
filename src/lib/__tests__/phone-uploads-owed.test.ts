import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Draining empties the phone's native buffers before the upload is known to
// have landed. A POST that failed — airplane mode still on at wake-up, flaky
// mobile data, a 401 from a WebView left open past its session, a 5xx — took
// that batch with it: a week of screen moments, and the Sleep API's one
// segment of the night, on exactly the ring-off morning it existed for.
//
// And a journey in progress when the app was opened was lost whole: the drain
// sent its ENTER alone, nothing paired, and the EXIT arrived in a later drain
// with no ENTER to close.
//
// So each stream keeps what it owes the server in Preferences until a POST is
// acknowledged, and the activity stream keeps its still-open tail as well.

const phone = vi.hoisted(() => ({
  prefs: new Map<string, string>(),
  sensors: [] as { ambient: unknown[]; phoneEvents: unknown[]; sleep: unknown[] }[],
  events: [] as { type: number; transition: number; at: number }[][],
}))

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({}),
}))
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: phone.prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { phone.prefs.set(key, value) },
    remove: async ({ key }: { key: string }) => { phone.prefs.delete(key) },
  },
}))
vi.mock("@/lib/native/bubble", () => ({
  sampleAmbient: async () => {},
  drainSensorData: async () => phone.sensors.shift() ?? { ambient: [], phoneEvents: [], sleep: [] },
  drainActivityEvents: async () => phone.events.shift() ?? [],
}))

const fetchMock = vi.fn()
const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body)

beforeEach(() => {
  vi.resetModules()
  phone.prefs.clear()
  phone.sensors = []
  phone.events = []
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

const load = () => import("@/lib/native/phone-uploads")
const night = { start: 1_000, end: 2_000, status: 0 }

describe("uploadPhoneSensors keeps a batch the server never took", () => {
  it("a POST that never arrived is sent again on the next foreground", async () => {
    const { uploadPhoneSensors } = await load()
    phone.sensors = [{ ambient: [], phoneEvents: [], sleep: [night] }]
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await uploadPhoneSensors()

    fetchMock.mockResolvedValue(new Response("{}"))
    await uploadPhoneSensors()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodyOf(1).sleep, "the night's segment was dropped with the failed POST").toEqual([night])
  })

  it("a refused POST (401, 5xx) is kept too", async () => {
    const { uploadPhoneSensors } = await load()
    phone.sensors = [{ ambient: [], phoneEvents: [{ at: 5, kind: "unlock" }], sleep: [] }]
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }))
    expect(await uploadPhoneSensors(), "a refused batch is reported as sent").toBe(0)

    phone.sensors = [{ ambient: [], phoneEvents: [{ at: 9, kind: "screen_off" }], sleep: [] }]
    fetchMock.mockResolvedValue(new Response("{}"))
    await uploadPhoneSensors()
    expect(bodyOf(1).phoneEvents).toEqual([{ at: 5, kind: "unlock" }, { at: 9, kind: "screen_off" }])
  })

  it("once acknowledged, it is not sent again", async () => {
    const { uploadPhoneSensors } = await load()
    phone.sensors = [{ ambient: [], phoneEvents: [], sleep: [night] }]
    fetchMock.mockResolvedValue(new Response("{}"))
    await uploadPhoneSensors()
    await uploadPhoneSensors()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("two callers at once do not both send the saved batch", async () => {
    const { uploadPhoneSensors } = await load()
    phone.sensors = [{ ambient: [], phoneEvents: [], sleep: [night] }]
    fetchMock.mockResolvedValue(new Response("{}"))
    await Promise.all([uploadPhoneSensors(), uploadPhoneSensors()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("uploadActivityEvents", () => {
  const now = Date.now()
  const enter = { type: 0, transition: 0, at: now - 8 * 60_000 }
  const exit = { type: 0, transition: 1, at: now - 60_000 }

  it("carries a journey still in progress into the next drain", async () => {
    const { uploadActivityEvents } = await load()
    fetchMock.mockResolvedValue(new Response("{}"))
    phone.events = [[enter]]
    await uploadActivityEvents()
    phone.events = [[exit]]
    await uploadActivityEvents()
    expect(
      bodyOf(fetchMock.mock.calls.length - 1).events,
      "the EXIT went up without its ENTER, so the leg never paired",
    ).toEqual([enter, exit])
  })

  it("does not re-send a carried ENTER on its own", async () => {
    const { uploadActivityEvents } = await load()
    fetchMock.mockResolvedValue(new Response("{}"))
    phone.events = [[enter]]
    await uploadActivityEvents()
    await uploadActivityEvents()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("keeps a failed batch for the next foreground", async () => {
    const { uploadActivityEvents } = await load()
    phone.events = [[enter, exit]]
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await uploadActivityEvents()
    fetchMock.mockResolvedValue(new Response("{}"))
    await uploadActivityEvents()
    expect(bodyOf(1).events).toEqual([enter, exit])
  })
})
