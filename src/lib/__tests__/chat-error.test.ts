import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import Anthropic from "@anthropic-ai/sdk"
import { describeChatFailure, logChatFailure } from "@/lib/chat-error"

// The failure this app will actually meet is the balance running out, and for
// as long as every cause produced one sentence, the only person who could fix
// it was told nothing.

// Built per class rather than through one factory: the SDK types each status
// as a literal, so a generic `new Cls(status, …)` does not typecheck.
const body = (message: string) => ({ type: "error", error: { type: "api_error", message } })
const h = () => new Headers()

const badRequest = (m: string) => new Anthropic.BadRequestError(400, body(m), m, h())
const unauthorized = (m: string) => new Anthropic.AuthenticationError(401, body(m), m, h())
const rateLimited = (m: string) => new Anthropic.RateLimitError(429, body(m), m, h())
const serverError = (m: string) => new Anthropic.InternalServerError(500, body(m), m, h())

describe("describeChatFailure", () => {
  it("names a spent balance, whatever class it arrives as", () => {
    const line = describeChatFailure(
      badRequest("Your credit balance is too low to access the Anthropic API"),
    )
    expect(line).toMatch(/run out of API credit/)
    expect(line).toMatch(/topping the account up/i)
  })

  it("tells a rotated key apart from a rate limit apart from an outage", () => {
    expect(describeChatFailure(unauthorized("invalid x-api-key")))
      .toMatch(/API key isn't being accepted/)
    expect(describeChatFailure(rateLimited("rate_limit_error")))
      .toMatch(/give it a minute/)
    expect(describeChatFailure(serverError("overloaded_error")))
      .toMatch(/Nothing wrong on your end/)
  })

  it("does not tell the user to retry something that cannot succeed", () => {
    // A 400 that is not about credit is the app's own malformed request.
    // "Try again" would send them round a loop with no exit.
    const line = describeChatFailure(badRequest("messages: at least one message is required"))
    expect(line).toMatch(/bug on my side/)
    expect(line).not.toMatch(/try again/i)
  })

  it("says it does not know rather than inventing a cause", () => {
    const line = describeChatFailure(new Error("kaboom"))
    expect(line).toMatch(/don't know what/)
    expect(line).toMatch(/logs/)
  })

  it("never blames the user's connection for a server-side failure", () => {
    // The mistake fetch-error.ts exists to correct, on the one path where the
    // browser's connection is not even involved.
    for (const e of [new Error("kaboom"), serverError("overloaded_error")]) {
      expect(describeChatFailure(e)).not.toMatch(/your connection|offline|wifi/i)
    }
  })
})

describe("logChatFailure", () => {
  it("keeps the status and the model's own words for whoever is debugging", () => {
    const line = JSON.parse(logChatFailure(rateLimited("rate_limit_error: slow down")))
    expect(line.status).toBe(429)
    expect(line.kind).toBe("RateLimitError")
    expect(line.message).toContain("slow down")
  })

  it("survives something that is not an Error at all", () => {
    expect(() => logChatFailure("just a string")).not.toThrow()
    expect(() => logChatFailure(undefined)).not.toThrow()
  })
})

describe("the chat route uses it", () => {
  const route = readFileSync("src/app/api/chat/route.ts", "utf8")

  it("no longer discards the thrown value", () => {
    expect(route).toContain("catch (error)")
    expect(route).toContain("describeChatFailure(error)")
    expect(route).not.toContain("Sorry, something went wrong")
  })

  it("logs the real failure as well as answering the user", () => {
    // The sentence a user reads is not a substitute for the line an owner needs.
    expect(route).toContain("logChatFailure(error)")
  })
})
