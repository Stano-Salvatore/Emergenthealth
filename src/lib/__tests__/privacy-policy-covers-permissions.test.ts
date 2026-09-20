import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The privacy policy said, in as many words, "We do not collect data in the
// background" — while the app shipped ACCESS_BACKGROUND_LOCATION and a
// foreground service whose entire job is to collect location with the app
// closed. It also never mentioned Health Connect, which is the policy that
// Health Connect's own permission-rationale screen links to.
//
// Neither is a bug anything can catch. The policy is prose on a page nothing
// imports, written before the feature existed and true when it was written.
// Play compares it to the app's behaviour, and a policy that denies what the
// manifest declares is the kind of contradiction that gets an app removed
// rather than rejected.
//
// So the permissions drive the check: what the build asks for decides what the
// policy has to talk about. This is a copy test and copy moves — if it fails
// because a sentence was reworded rather than because a claim changed, update
// the pattern. It is deliberately three checks and not thirty; each is tied to
// a permission whose absence from the policy is a compliance problem, not a
// style one.

const MANIFEST = ".ci/customize-android.py"
const POLICY = "src/app/privacy/page.tsx"

const manifest = () => readFileSync(MANIFEST, "utf8")
const policy = () => readFileSync(POLICY, "utf8")

describe("the privacy policy covers what the app actually asks for", () => {
  it("does not deny background collection while declaring background location", () => {
    if (!manifest().includes("android.permission.ACCESS_BACKGROUND_LOCATION")) return

    const denial = /(do not|don.t|never)\s+collect[^.]{0,80}background/i
    expect(
      denial.test(policy()),
      "The build declares ACCESS_BACKGROUND_LOCATION and the privacy policy says it does not " +
        "collect data in the background. One of the two has to change, and it is not the policy " +
        "unless the feature goes.",
    ).toBe(false)

    const disclosure = /background|app is closed|not in use/i
    expect(
      disclosure.test(policy()),
      "The build declares ACCESS_BACKGROUND_LOCATION and the privacy policy never mentions " +
        "collecting anything while the app is closed. Play reads both.",
    ).toBe(true)
  })

  it("describes Health Connect when it reads Health Connect", () => {
    if (!manifest().includes("android.permission.health.")) return

    expect(
      policy().includes("Health Connect"),
      "The app reads Health Connect, and the manifest points its permission-rationale screen at " +
        "this policy — which does not mention Health Connect at all. Publishing requires it to " +
        "say what happens to that data.",
    ).toBe(true)
  })

  it("accounts for the microphone when it holds RECORD_AUDIO", () => {
    if (!manifest().includes("android.permission.RECORD_AUDIO")) return

    expect(
      /microphone/i.test(policy()),
      "The build declares RECORD_AUDIO and the privacy policy never mentions the microphone. " +
        "An app that asks for it and says nothing is the one reviewers ask about.",
    ).toBe(true)
  })
})
