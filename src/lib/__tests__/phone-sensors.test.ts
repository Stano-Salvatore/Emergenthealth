import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The phone's own sensors, and the two ways this feature can rot quietly.
//
// It is built on one claim: none of it costs a permission the app did not
// already hold. Light and pressure need none at all, the screen and charge
// broadcasts need none, and the Sleep API runs on the ACTIVITY_RECOGNITION
// grant the travel-mode transitions already use. That claim is what made it
// safe to add while a Play health-apps declaration was being filled in, and
// `play-permissions-documented.test.ts` already fails on a permission with no
// COMPLIANCE.md row — so the permission surface is covered.
//
// What is NOT covered is below.

const NATIVE_RECEIVER = "android-widget/EmergyPhoneEventReceiver.java"
const BRIDGE = "src/lib/native/bubble.ts"
const ROUTE = "src/app/api/phone/sensors/route.ts"
const BUILD = ".ci/customize-android.py"

/** The quoted values of the receiver's kind constants. */
const nativeKinds = (): string[] => {
  const src = readFileSync(NATIVE_RECEIVER, "utf8")
  return [...src.matchAll(/private static final String [A-Z_]+ = "([a-z_]+)";/g)]
    .map(m => m[1])
    .sort()
}

/** The contents of a `new Set([...])` assigned to the named const. */
const setLiteral = (file: string, name: string): string[] => {
  const src = readFileSync(file, "utf8")
  const m = new RegExp(`${name}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]`).exec(src)
  if (!m) return []
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map(x => x[1]).sort()
}

describe("the phone-event kinds agree everywhere", () => {
  // Three copies of one list: the receiver writes them, the bridge filters on
  // them, the route validates against them. Add a sixth kind in the Java and
  // forget one of the other two and it is dropped in silence — no error, no
  // failed request, just a column that never fills. Exactly the shape of
  // failure this codebase keeps finding months late.
  it("the receiver, the bridge and the route name the same set", () => {
    const native = nativeKinds()

    expect(
      native.length,
      `No kind constants found in ${NATIVE_RECEIVER}. They were written as ` +
        "`private static final String NAME = \"value\";` — if that changed, this guard is reading nothing.",
    ).toBeGreaterThan(3)

    const bridge = setLiteral(BRIDGE, "PHONE_EVENT_KINDS")
    const route = setLiteral(ROUTE, "KINDS")

    expect(
      bridge,
      `${BRIDGE} filters on [${bridge.join(", ")}] but the receiver emits [${native.join(", ")}]. ` +
        "An event the bridge does not recognise is dropped before it is ever sent, silently.",
    ).toEqual(native)

    expect(
      route,
      `${ROUTE} accepts [${route.join(", ")}] but the receiver emits [${native.join(", ")}]. ` +
        "An event the route does not recognise is dropped after a successful-looking POST.",
    ).toEqual(native)
  })
})

describe("the screen receiver stays out of the manifest", () => {
  // The inverse of the usual check, and it has to be written down because
  // adding it looks like a fix.
  //
  // ACTION_SCREEN_ON and ACTION_SCREEN_OFF are protected broadcasts Android
  // delivers ONLY to receivers registered with registerReceiver(). A manifest
  // entry for them is accepted without complaint and never fires. So the
  // build script's "every component is declared" check — which exists to catch
  // the opposite mistake — exempts this one class by name, and someone reading
  // that exemption as an oversight would "fix" it into a receiver that
  // collects nothing at all.
  it("is not declared, and the build knows why", () => {
    const build = readFileSync(BUILD, "utf8")

    expect(
      build.includes('android:name=".EmergyPhoneEventReceiver"'),
      "customize-android.py declares EmergyPhoneEventReceiver in the manifest. SCREEN_ON and " +
        "SCREEN_OFF are never delivered to a manifest-declared receiver, so this collects nothing " +
        "while looking correct. It is registered by the foreground services instead.",
    ).toBe(false)

    // The exemption must stay, or the build fails on a class that is missing
    // from the manifest on purpose.
    expect(
      build.includes('cls == "EmergyPhoneEventReceiver"'),
      "The undeclared-component check no longer exempts EmergyPhoneEventReceiver, so the Android " +
        "build will fail on a receiver that is deliberately not in the manifest.",
    ).toBe(true)
  })

  it("is registered at runtime by a service that can host it", () => {
    // If neither service registers it, nothing is collected and the Settings
    // card's "Recording" line is a lie.
    const hosts = ["android-widget/EmergyLocationService.java", "android-widget/EmergyWakeService.java"]
    const registering = hosts.filter(f =>
      readFileSync(f, "utf8").includes("EmergyPhoneEventReceiver.register("))

    expect(
      registering,
      "No foreground service registers EmergyPhoneEventReceiver any more. Its broadcasts cannot come " +
        "from the manifest, so nothing is collecting screen or charge moments — and the Settings card " +
        "still says it is.",
    ).toEqual(hosts)

    // Registered and never released is a leak the system logs on every stop.
    for (const f of hosts) {
      expect(
        readFileSync(f, "utf8").includes("EmergyPhoneEventReceiver.unregister("),
        `${f} registers the phone-event receiver and never unregisters it.`,
      ).toBe(true)
    }
  })
})
