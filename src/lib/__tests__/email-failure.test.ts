import { describe, it, expect, vi, afterEach } from "vitest"

// `EMAIL_FROM` falls back to Resend's shared sandbox, which delivers only to
// the Resend account's owner. The comment at the top of lib/email.ts already
// says what that costs — "every other user's digest, review and export 'sent'
// and then failed silently at the provider" — and the crons went on catching
// the rejection and throwing it away, so a deployment whose email has never
// reached a single person looked exactly like one that works.
//
// The environment is read at module load, so each case re-imports.
const load = async (from: string | undefined) => {
  vi.resetModules()
  if (from == null) delete process.env.EMAIL_FROM
  else process.env.EMAIL_FROM = from
  return import("@/lib/email")
}

const ORIGINAL = process.env.EMAIL_FROM
afterEach(() => {
  if (ORIGINAL == null) delete process.env.EMAIL_FROM
  else process.env.EMAIL_FROM = ORIGINAL
})

describe("a failed send says which failure it was", () => {
  it("names the unset sender before reading the provider's wording", async () => {
    const { describeMailFailure, EMAIL_SENDER_CONFIGURED } = await load(undefined)
    expect(EMAIL_SENDER_CONFIGURED).toBe(false)
    // Deliberately a rate-limit error: with no sender configured, that is not
    // the user's problem and not the fix. The check order matters, because a
    // 403 from the sandbox is the error this deployment actually meets and
    // its text is the provider's to change, not ours.
    const said = describeMailFailure(new Error("429 too many requests"))
    expect(said).toMatch(/EMAIL_FROM/)
    expect(said).toMatch(/sandbox/i)
  })

  it("reads the provider once a real sender exists", async () => {
    const { describeMailFailure } = await load("Emergenthealth <hi@example.com>")
    expect(describeMailFailure(new Error("429 too many requests"))).toMatch(/rate-limiting/i)
    expect(describeMailFailure(new Error("domain is not verified"))).toMatch(/domain/i)
    expect(describeMailFailure(new Error("payload too large"))).toMatch(/too large/i)
    // Anything it cannot place still says so rather than inventing a cause.
    expect(describeMailFailure(new Error("kaboom"))).toBe("The mail service rejected the message.")
  })

  it("never writes a whole address into a log that outlives the request", async () => {
    const { logMailFailure } = await load("Emergenthealth <hi@example.com>")
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    logMailFailure("weekly review", "someone@example.com", new Error("kaboom"))
    const line = spy.mock.calls[0].join(" ")
    expect(line).not.toContain("someone@example.com")
    expect(line).toContain("s***@example.com")
    // Fixed width, so the mask does not hand out the local part's length.
    expect(line).not.toMatch(/s\*{4,}@/)
    // The domain survives, because "is it every user or just gmail" is the
    // first question anyone asks of a delivery problem.
    expect(line).toContain("example.com")
    spy.mockRestore()
  })
})
