import { describe, it, expect } from "vitest"
import { generateKeyPairSync } from "node:crypto"
import { buildJwt, buildMessage, isDeadToken, loadServiceAccount } from "@/lib/fcm"

// The parts that can be checked without Google on the other end.
//
// The send itself needs a real service account and a real device token, so
// what is pinned here is everything that would otherwise fail silently: the
// assertion's shape, the message being data-only, and — the one that matters
// most — which failures mean "this phone is gone" versus "try again later".
// Deleting a token because the network hiccupped would unregister a working
// device and leave nothing to say why it went quiet.

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString()

const ACCOUNT = {
  project_id: "emergenthealth",
  client_email: "push@emergenthealth.iam.gserviceaccount.com",
  private_key: PEM,
}

function decodeSegment(jwt: string, index: number) {
  return JSON.parse(Buffer.from(jwt.split(".")[index], "base64url").toString("utf8"))
}

describe("loadServiceAccount", () => {
  it("reads raw JSON", () => {
    expect(loadServiceAccount(JSON.stringify(ACCOUNT))?.client_email).toBe(ACCOUNT.client_email)
  })

  it("reads base64, which is how a PEM survives an env var intact", () => {
    const encoded = Buffer.from(JSON.stringify(ACCOUNT)).toString("base64")
    expect(loadServiceAccount(encoded)?.project_id).toBe("emergenthealth")
  })

  it("repairs newlines mangled into \\n by a form field", () => {
    const mangled = { ...ACCOUNT, private_key: "-----BEGIN-----\\nabc\\n-----END-----" }
    expect(loadServiceAccount(JSON.stringify(mangled))?.private_key).toBe("-----BEGIN-----\nabc\n-----END-----")
  })

  it("treats absent and malformed config as absent, not as an error", () => {
    expect(loadServiceAccount(undefined)).toBeNull()
    expect(loadServiceAccount("")).toBeNull()
    expect(loadServiceAccount("not json")).toBeNull()
    expect(loadServiceAccount(JSON.stringify({ project_id: "x" }))).toBeNull()
  })
})

describe("buildJwt", () => {
  it("claims the messaging scope, from this account, to Google's token endpoint", () => {
    const claims = decodeSegment(buildJwt(ACCOUNT, 1_700_000_000), 1)
    expect(claims.iss).toBe(ACCOUNT.client_email)
    expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging")
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token")
    expect(claims.exp - claims.iat).toBe(3600)
  })

  it("is RS256 and actually signed", () => {
    const jwt = buildJwt(ACCOUNT, 1_700_000_000)
    expect(decodeSegment(jwt, 0)).toEqual({ alg: "RS256", typ: "JWT" })
    expect(jwt.split(".")).toHaveLength(3)
    expect(jwt.split(".")[2].length).toBeGreaterThan(100)
  })

  it("is base64url, so it survives being a URL parameter", () => {
    const jwt = buildJwt(ACCOUNT, 1_700_000_001)
    expect(jwt).not.toMatch(/[+/=]/)
  })
})

describe("buildMessage", () => {
  it("carries no notification block", () => {
    // The whole point. A `notification` message is drawn by the system tray
    // when the app is backgrounded and never reaches our handler — which is
    // precisely the case the chat head exists for.
    const msg = buildMessage("tok", { title: "Emergy", body: "Water. Now." }) as
      { message: Record<string, unknown> }
    expect(msg.message).not.toHaveProperty("notification")
    expect(msg.message.data).toEqual({ title: "Emergy", body: "Water. Now." })
  })

  it("asks for high priority, or a held message is a missed reminder", () => {
    const msg = buildMessage("tok", { title: "a", body: "b" }) as
      { message: { android: { priority: string } } }
    expect(msg.message.android.priority).toBe("HIGH")
  })

  it("passes url and tag through only when present", () => {
    const withUrl = buildMessage("tok", { title: "a", body: "b", url: "/dashboard", tag: "water" }) as
      { message: { data: Record<string, string> } }
    expect(withUrl.message.data.url).toBe("/dashboard")
    expect(withUrl.message.data.tag).toBe("water")
  })
})

describe("isDeadToken", () => {
  it("recognises a phone that has thrown the token away", () => {
    expect(isDeadToken(404, "")).toBe(true)
    expect(isDeadToken(400, '{"error":{"status":"INVALID_ARGUMENT","message":"Invalid registration token"}}')).toBe(true)
    expect(isDeadToken(403, "SenderId mismatch")).toBe(true)
  })

  it("keeps the token when the failure was ours or the network's", () => {
    // Unregistering a working device over a 500 would silence it with nothing
    // anywhere saying why.
    expect(isDeadToken(500, "internal")).toBe(false)
    expect(isDeadToken(503, "unavailable")).toBe(false)
    expect(isDeadToken(429, "quota")).toBe(false)
    expect(isDeadToken(401, "expired credentials")).toBe(false)
    // A 400 that isn't about the token — a malformed message is our bug.
    expect(isDeadToken(400, '{"error":{"message":"Invalid JSON payload"}}')).toBe(false)
  })
})
