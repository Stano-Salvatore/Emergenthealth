import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { ensureWidgetActivation } from "@/lib/widget-activator"

// Four home-screen widgets read one key out of storage. Nothing wrote it
// unless the user found "Activate Widget" in Settings, so in practice they all
// sat on the home screen saying "Set up in the app" forever. These tests pin
// the behaviour that replaced it: the app links itself, mints a key when the
// account has none, and re-links when the key or the origin has moved.

function fakeStore() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    map,
  }
}

let store: ReturnType<typeof fakeStore>

beforeEach(() => {
  store = fakeStore()
  // @ts-expect-error test shim
  globalThis.window = { location: { origin: "https://emergenthealth.vercel.app" } }
  // @ts-expect-error test shim
  globalThis.localStorage = store
})

afterEach(() => {
  // @ts-expect-error test shim
  delete globalThis.window
  // @ts-expect-error test shim
  delete globalThis.localStorage
  vi.unstubAllGlobals()
})

function mockFetch(handlers: Record<string, () => unknown>) {
  const calls: string[] = []
  vi.stubGlobal("fetch", vi.fn((url: string, init?: { method?: string }) => {
    const label = `${init?.method ?? "GET"} ${url}`
    calls.push(label)
    const h = handlers[label]
    if (!h) return Promise.resolve({ ok: false, json: async () => ({}) })
    return Promise.resolve({ ok: true, json: async () => h() })
  }))
  return calls
}

describe("ensureWidgetActivation", () => {
  it("stores the account's key so the widgets can use it", async () => {
    mockFetch({ "GET /api/widget/key": () => ({ key: "wgt_abc" }) })
    expect(await ensureWidgetActivation()).toBe("synced")
    expect(store.getItem("widget_api_key")).toBe("wgt_abc")
    expect(store.getItem("widget_app_url")).toBe("https://emergenthealth.vercel.app")
  })

  it("mints a key when the account has never had one", async () => {
    // Without this, a user who never opened the widget settings page has no key
    // at all, and every widget is dead on arrival.
    const calls = mockFetch({
      "GET /api/widget/key": () => ({ key: null }),
      "POST /api/widget/key": () => ({ key: "wgt_new" }),
    })
    expect(await ensureWidgetActivation()).toBe("synced")
    expect(calls).toContain("POST /api/widget/key")
    expect(store.getItem("widget_api_key")).toBe("wgt_new")
  })

  it("writes nothing when the stored pair already matches", async () => {
    store.setItem("widget_api_key", "wgt_abc")
    store.setItem("widget_app_url", "https://emergenthealth.vercel.app")
    mockFetch({ "GET /api/widget/key": () => ({ key: "wgt_abc" }) })
    expect(await ensureWidgetActivation()).toBe("unchanged")
  })

  it("re-links after the key is regenerated", async () => {
    store.setItem("widget_api_key", "wgt_old")
    store.setItem("widget_app_url", "https://emergenthealth.vercel.app")
    mockFetch({ "GET /api/widget/key": () => ({ key: "wgt_rotated" }) })
    expect(await ensureWidgetActivation()).toBe("synced")
    expect(store.getItem("widget_api_key")).toBe("wgt_rotated")
  })

  it("fails quietly when signed out, leaving any working key alone", async () => {
    store.setItem("widget_api_key", "wgt_abc")
    mockFetch({})
    expect(await ensureWidgetActivation()).toBe("failed")
    expect(store.getItem("widget_api_key")).toBe("wgt_abc")
  })
})
