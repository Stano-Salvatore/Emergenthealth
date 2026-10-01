import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { DAILY_EMERGY_LIMIT, isOwnerEmail, quotaReply } from "@/lib/emergy-quota"

const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("who is limited", () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it("the owner is not, whatever the case of the address", () => {
    process.env.FEEDBACK_NOTIFY_EMAIL = "Owner@Example.com"
    expect(isOwnerEmail("owner@example.com")).toBe(true)
    expect(isOwnerEmail("friend@example.com")).toBe(false)
    expect(isOwnerEmail(null)).toBe(false)
  })

  it("with no owner configured, everyone is", () => {
    delete process.env.FEEDBACK_NOTIFY_EMAIL
    delete process.env.OWNER_EMAIL
    expect(isOwnerEmail("owner@example.com")).toBe(false)
  })
})

describe("the reply when the day's messages are used", () => {
  it("names the limit and what still works, and only what the quick path really answers", () => {
    const r = quotaReply()
    expect(r).toContain(String(DAILY_EMERGY_LIMIT))
    expect(r).toMatch(/tomorrow/)
    expect(r).toMatch(/log 300ml water/)
    expect(r).toMatch(/how was my sleep this week/)
  })

  it("from Telegram, which has no quick path, it points to the app instead", () => {
    expect(quotaReply("telegram")).toMatch(/In the app's chat/)
    expect(strip("src/app/api/telegram/webhook/route.ts")).toMatch(/quotaReply\("telegram"\)/)
  })
})

describe("wiring", () => {
  it("web chat: quick logs and lookups are answered before the count, the model only after it", () => {
    const src = strip("src/app/api/chat/route.ts")
    const quick = src.indexOf("runQuickAnswer(")
    const claim = src.indexOf("claimEmergyTurn(")
    const model = src.indexOf("streamChatEvents(")
    expect(quick).toBeGreaterThan(-1)
    expect(claim).toBeGreaterThan(quick)
    expect(model).toBeGreaterThan(claim)
  })

  it("Telegram reaches the same model, so it spends the same allowance", () => {
    const src = strip("src/app/api/telegram/webhook/route.ts")
    expect(src.indexOf("claimEmergyTurn(")).toBeGreaterThan(-1)
    expect(src.indexOf("claimEmergyTurn(")).toBeLessThan(src.indexOf("streamChatResponse(userId"))
  })
})
