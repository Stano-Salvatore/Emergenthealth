import { describe, it, expect } from "vitest"
import { registerPlugin } from "@capacitor/core"
import { readFileSync } from "node:fs"

// Background location reported itself unavailable on every device it ever ran
// on, and no test noticed, because the failure was in how the plugin was
// obtained rather than in any logic. `await import(...)` of the plugin package
// threw, a catch turned that into "unavailable", and the settings card politely
// explained that only the Android app can track — inside the Android app.
//
// These two assertions pin the reason, so the working form is not "simplified"
// back into the broken one.

const PKG = "@capacitor-community/background-geolocation"
const SOURCE = "src/lib/native/background-location.ts"

describe("the background-geolocation plugin package", () => {
  // If this ever fails, the package has started shipping JavaScript and the
  // registerPlugin dance below could be reconsidered — that is worth knowing,
  // which is why this asserts rather than assumes.
  it("ships no JavaScript, so there is nothing to import at runtime", () => {
    const pkg = JSON.parse(readFileSync(`node_modules/${PKG}/package.json`, "utf8"))
    expect(pkg.main).toBeUndefined()
    expect(pkg.module).toBeUndefined()
    expect(pkg.exports).toBeUndefined()
    // Only types, native sources and build files.
    expect(pkg.types).toBe("definitions.d.ts")
  })
})

describe("how background-location.ts obtains the plugin", () => {
  const src = readFileSync(SOURCE, "utf8")

  it("asks Capacitor whether the native class is actually in the APK", () => {
    // registerPlugin returns a proxy on any platform, so the plugin looks
    // present in an APK built before it was added — and the JS half updates
    // from the server on every load while the native half needs an install.
    // isPluginAvailable is the only thing that can tell those apart.
    expect(src).toContain('Capacitor.isPluginAvailable("BackgroundGeolocation")')
  })

  it("a plugin proxy is a thenable, so awaiting one calls the native bridge", () => {
    // The whole feature hung on this. registerPlugin answers EVERY property
    // with a bridge-calling function, `then` included — so the proxy passing
    // through promise resolution makes the runtime invoke `then(resolve,
    // reject)`, posting a call for a method no plugin implements. On Android
    // nothing answers and nothing rejects: pending forever.
    const proxy = registerPlugin("APluginThatDoesNotExist") as unknown as Record<string, unknown>
    expect(typeof proxy.then).toBe("function")
  })

  it("never lets the plugin pass through promise resolution", () => {
    // Returning it from an async function is enough to resolve it, which is
    // exactly how this was written when start, stop, openSettings and the
    // availability check all hung on a real device while every call inside
    // them measured 4ms.
    expect(src).toMatch(/\nfunction loadPlugin\(\): BackgroundGeolocationPlugin \| null/)
    expect(src).not.toContain("async function loadPlugin")
    expect(src).not.toContain("await loadPlugin")
  })

  it("registers it by the name the Android class declares", () => {
    expect(src).toContain('registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation")')
  })

  // The bug, stated directly: any runtime import of this package is a no-op
  // that fails silently. A type-only import is fine and is what we use.
  it("never imports the package for its runtime value", () => {
    expect(src).not.toMatch(new RegExp(`(?<!type )\\bimport\\s*\\(\\s*["']${PKG.replace("/", "\\/")}`))
    expect(src).toContain(`import type {`)
  })
})
