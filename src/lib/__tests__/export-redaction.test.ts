import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { EXCLUDED_TABLES, redactRow } from "@/lib/export"

// The backup is mailed as an attachment on the 1st of every month, and
// downloaded or emailed on request. Credential tables were excluded by name —
// but GitHubProfile is not a credential table, it is a profile with a live
// personal access token in one column, and it went out in plain text. FcmToken
// (a device push token) went out too.
//
// Redaction is now by column, for every table: anything named like a secret
// leaves as "[redacted]", while the counts that merely end in "Tokens"
// (ModelTurn.inputTokens) stay numbers.

describe("redactRow", () => {
  it("redacts the GitHub access token and keeps the username", () => {
    const out = redactRow("GitHubProfile", { userId: "u", username: "octo", accessToken: "ghp_live" })
    expect(out).toEqual({ userId: "u", username: "octo", accessToken: "[redacted]" })
  })

  it("redacts any secret-shaped column, whatever the table", () => {
    const out = redactRow("SomeFutureTable", {
      refreshToken: "r", client_secret: "s", password: "p", apiKey: "k", api_key: "k2", credentialJson: "c", note: "fine",
    })
    expect(out).toEqual({
      refreshToken: "[redacted]", client_secret: "[redacted]", password: "[redacted]",
      apiKey: "[redacted]", api_key: "[redacted]", credentialJson: "[redacted]", note: "fine",
    })
  })

  it("keeps token counts, which are usage numbers rather than secrets", () => {
    const row = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 }
    expect(redactRow("ModelTurn", row)).toEqual(row)
  })

  it("leaves an absent secret absent rather than inventing a redaction", () => {
    expect(redactRow("GitHubProfile", { username: "octo", accessToken: null })).toEqual({ username: "octo", accessToken: null })
  })

  it("still redacts credential-shaped UserPreference values", () => {
    expect(redactRow("UserPreference", { key: "toggl_api_token", value: "abc" }).value).not.toBe("abc")
    expect(redactRow("UserPreference", { key: "timezone", value: "Europe/Prague" }).value).toBe("Europe/Prague")
  })
})

// Guard over the schema: a user table that grows a token-shaped column is
// either excluded from the export or has that column redacted. A new
// integration cannot quietly put its secret back in people's inboxes.
describe("every token-shaped column in a user table", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8")
  const models = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)]
    .filter(([, , body]) => /^\s+userId\s/m.test(body))

  it("finds the user tables", () => {
    expect(models.length).toBeGreaterThan(30)
  })

  for (const [, name, body] of models) {
    if (EXCLUDED_TABLES.has(name)) continue
    const fields = body.split("\n").map(l => l.trim().split(/\s+/)[0]).filter(f => f && /^[A-Za-z_]\w*$/.test(f))
    const risky = fields.filter(f => /(token|secret|password|api_?key|credential)/i.test(f))
    for (const field of risky) {
      it(`${name}.${field} does not leave in the export`, () => {
        const out = redactRow(name, { [field]: "sensitive-value" })
        if (/Tokens$/.test(field)) return // a count, e.g. ModelTurn.inputTokens
        expect(out[field]).toBe("[redacted]")
      })
    }
  }

  it("excludes the device push tokens outright", () => {
    expect(EXCLUDED_TABLES.has("FcmToken")).toBe(true)
  })
})
