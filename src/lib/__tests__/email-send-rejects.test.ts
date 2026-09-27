import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import type { Resend } from "resend"
import { sendMail } from "@/lib/email"

// Resend's emails.send() does not throw when the provider refuses a message:
// it resolves { data: null, error }. Every caller wrapped it in try/catch and
// counted anything that did not throw as sent — so a revoked key, a spent
// daily quota or an outage made "Email me the backup" answer {ok: true} and
// the monthly backup cron log emailed: 1, while nothing ever arrived. The one
// off-site copy of the owner's history was believed to exist and did not.

const fake = (result: unknown) => ({ emails: { send: async () => result } }) as unknown as Resend

describe("sendMail", () => {
  it("resolves when the provider accepted the message", async () => {
    await expect(sendMail(fake({ data: { id: "e1" }, error: null }), { from: "a@b.c", to: "d@e.f", subject: "s", html: "h" }))
      .resolves.toBeUndefined()
  })

  it("rejects when the provider refused it, with the status the describer reads", async () => {
    const refused = fake({ data: null, error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" } })
    await expect(sendMail(refused, { from: "a@b.c", to: "d@e.f", subject: "s", html: "h" }))
      .rejects.toThrow(/429/)
  })
})

describe("no caller trusts emails.send() to throw", () => {
  it("routes every send through sendMail", () => {
    const out = execSync(`grep -rln "emails\\.send(" src --include=*.ts --include=*.tsx || true`, { encoding: "utf8" })
    const files = out.split("\n").map(s => s.trim()).filter(Boolean)
      .filter(f => !f.includes("__tests__"))
      .filter(f => {
        // Comments do not send anything.
        const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
        return /emails\.send\(/.test(code)
      })
    const ALLOWED = [
      "src/lib/email.ts", // sendMail itself
      "src/app/api/feedback/route.ts", // fire-and-forget note to the owner; nobody is told it was sent
    ]
    expect(files.filter(f => !ALLOWED.includes(f)), "call sendMail(resend, …) instead — it turns a refusal into a throw").toEqual([])
  })
})
