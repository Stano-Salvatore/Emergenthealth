import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { printSupport, printPage } from "@/lib/native/print"

// The bug this guards: window.print() exists inside an Android WebView and
// silently does nothing. Every case below is a surface the app actually runs
// on, and the one that must never come back is "native shell, no bridge,
// button pretends it worked".

function setWindow(w: Record<string, unknown> | undefined) {
  if (w === undefined) {
    // @ts-expect-error test shim
    delete globalThis.window
  } else {
    // @ts-expect-error test shim
    globalThis.window = w
  }
}

afterEach(() => setWindow(undefined))

describe("printSupport", () => {
  it("says none on the server, where there is nothing to print with", () => {
    setWindow(undefined)
    expect(printSupport()).toBe("none")
  })

  it("says web in an ordinary browser", () => {
    setWindow({ print: () => {} })
    expect(printSupport()).toBe("web")
  })

  it("says native when the app exposes the print bridge", () => {
    setWindow({ EhPrint: { print: () => {} }, Capacitor: { isNativePlatform: () => true } })
    expect(printSupport()).toBe("native")
  })

  it("says none in an app build older than the bridge", () => {
    // This is exactly the state of the installed APK: a native shell whose
    // window.print() is inert. Calling it would look like success and do
    // nothing, so the surface has to admit it cannot print.
    setWindow({ print: () => {}, Capacitor: { isNativePlatform: () => true } })
    expect(printSupport()).toBe("none")
  })
})

describe("printPage", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("drives the native bridge when it is there", () => {
    const print = vi.fn()
    setWindow({ EhPrint: { print }, Capacitor: { isNativePlatform: () => true } })
    expect(printPage("Health report")).toBe(true)
    expect(print).toHaveBeenCalledWith("Health report")
  })

  it("uses window.print in a browser", () => {
    const print = vi.fn()
    setWindow({ print })
    expect(printPage("Health report")).toBe(true)
    expect(print).toHaveBeenCalled()
  })

  it("refuses rather than calling the no-op window.print in an old app build", () => {
    const print = vi.fn()
    setWindow({ print, Capacitor: { isNativePlatform: () => true } })
    expect(printPage("Health report")).toBe(false)
    expect(print).not.toHaveBeenCalled()
  })

  it("reports failure when the bridge throws", () => {
    setWindow({ EhPrint: { print: () => { throw new Error("no print service") } } })
    expect(printPage("Health report")).toBe(false)
  })
})
