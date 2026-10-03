import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "node:crypto"
import { NextRequest } from "next/server"

// Connecting Claude to the app runs an OAuth code flow. The "code" used to be
// the user's permanent MCP key itself — full read/write on their health data —
// handed over in a redirect URL (browser history, logs, Referer), with the
// PKCE challenge collected and never checked, and no click needed: any page
// could send a signed-in user through it. Now the code is one-time and
// short-lived, only the client holding the PKCE verifier can exchange it, and
// a signed-in user is asked before anything is handed out.

const KEY = "mcp_fit_permanent_key_abcdef"
const store = vi.hoisted(() => ({ tokens: [] as { identifier: string; token: string; expires: Date }[] }))
const session = vi.hoisted(() => ({ user: { id: "u1", email: "a@example.com" } as { id: string; email: string } | null }))

vi.mock("@/auth", () => ({ auth: async () => (session.user ? { user: session.user } : null) }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mcpApiKey: {
      findFirst: async () => ({ id: "k1", userId: "u1", token: KEY }),
      findUnique: async ({ where }: { where: { token?: string; id?: string } }) =>
        where.token === KEY || where.id === "k1" ? { id: "k1", userId: "u1", token: KEY } : null,
    },
    verificationToken: {
      create: async ({ data }: { data: { identifier: string; token: string; expires: Date } }) => { store.tokens.push(data); return data },
      findFirst: async ({ where }: { where: { identifier: string } }) =>
        store.tokens.find(t => t.identifier === where.identifier && t.expires > new Date()) ?? null,
      deleteMany: async ({ where }: { where: { identifier: string } }) => {
        const before = store.tokens.length
        store.tokens = store.tokens.filter(t => t.identifier !== where.identifier)
        return { count: before - store.tokens.length }
      },
    },
  },
}))

import { GET as AUTHORIZE, POST as AUTHORIZE_POST } from "@/app/api/mcp/authorize/route"
import { POST as TOKEN } from "@/app/api/mcp/token/route"

const VERIFIER = "a-long-random-verifier-string-0123456789-abcdefghijklmnop"
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url")
const REDIRECT = "https://claude.ai/api/mcp/auth_callback"
const params = `redirect_uri=${encodeURIComponent(REDIRECT)}&state=s1&code_challenge=${CHALLENGE}&code_challenge_method=S256`

const form = (fields: Record<string, string>) =>
  new NextRequest("http://localhost/api/mcp/authorize", { method: "POST", body: new URLSearchParams(fields) })

const exchange = (fields: Record<string, string>) =>
  TOKEN(new NextRequest("http://localhost/api/mcp/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "10.0.0.1" },
    body: new URLSearchParams({ grant_type: "authorization_code", ...fields }),
  }))

async function allow(): Promise<string> {
  const res = await AUTHORIZE_POST(form({
    action: "allow", redirect_uri: REDIRECT, state: "s1", code_challenge: CHALLENGE, code_challenge_method: "S256",
  }))
  const loc = new URL(res.headers.get("location")!)
  expect(loc.origin + loc.pathname).toBe(REDIRECT)
  expect(loc.searchParams.get("state")).toBe("s1")
  return loc.searchParams.get("code")!
}

beforeEach(() => { store.tokens = []; session.user = { id: "u1", email: "a@example.com" } })

describe("connecting Claude", () => {
  it("a signed-in user is asked first — nothing is handed out on a bare visit", async () => {
    const res = await AUTHORIZE(new NextRequest(`http://localhost/api/mcp/authorize?${params}`))
    expect(res.status).toBe(200)
    expect(res.headers.get("location")).toBeNull()
    const html = await res.text()
    expect(html).toContain('value="allow"')
    expect(html).not.toContain(KEY)
  })

  it("the code in the redirect is not the key", async () => {
    const code = await allow()
    expect(code).toBeTruthy()
    expect(code).not.toContain(KEY)
  })

  it("the code buys the key once, and only with the verifier", async () => {
    const code = await allow()
    expect((await exchange({ code, code_verifier: "wrong" })).status).toBe(400)
    const code2 = await allow()
    const ok = await exchange({ code: code2, code_verifier: VERIFIER, redirect_uri: REDIRECT })
    expect(ok.status).toBe(200)
    expect((await ok.json()).access_token).toBe(KEY)
    expect((await exchange({ code: code2, code_verifier: VERIFIER })).status).toBe(400)
  })

  it("a code asked for with a challenge can't be redeemed without a verifier", async () => {
    const code = await allow()
    expect((await exchange({ code })).status).toBe(400)
  })

  it("a code is bound to the redirect it was issued for", async () => {
    const code = await allow()
    expect((await exchange({ code, code_verifier: VERIFIER, redirect_uri: "http://localhost:9999/cb" })).status).toBe(400)
  })

  it("a challenge sent without a method is plain, as the spec says", async () => {
    const res = await AUTHORIZE_POST(form({ action: "allow", redirect_uri: REDIRECT, code_challenge: VERIFIER }))
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!
    expect((await exchange({ code, code_verifier: VERIFIER })).status).toBe(200)
  })

  it("the permanent key is no longer accepted as a code", async () => {
    expect((await exchange({ code: KEY })).status).toBe(400)
  })

  it("pasting the key on the form also returns a one-time code, never the key", async () => {
    session.user = null
    const res = await AUTHORIZE_POST(form({
      api_key: KEY, redirect_uri: REDIRECT, state: "s1", code_challenge: CHALLENGE, code_challenge_method: "S256",
    }))
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!
    expect(code).not.toContain(KEY)
    expect((await (await exchange({ code, code_verifier: VERIFIER })).json()).access_token).toBe(KEY)
  })

  it("allowing without a session goes back to the key form", async () => {
    session.user = null
    const res = await AUTHORIZE_POST(form({ action: "allow", redirect_uri: REDIRECT, code_challenge: CHALLENGE, code_challenge_method: "S256" }))
    expect(res.headers.get("location")).toBeNull()
    expect(await res.text()).toContain('name="api_key"')
  })

  it("a body that isn't a form is a 400, not a crash", async () => {
    const res = await AUTHORIZE_POST(new NextRequest("http://localhost/api/mcp/authorize", {
      method: "POST", body: "{}", headers: { "content-type": "application/json" },
    }))
    expect(res.status).toBe(400)
  })
})
