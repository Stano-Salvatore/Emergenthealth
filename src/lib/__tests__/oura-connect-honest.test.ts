import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// Oura stopped issuing personal access tokens in December 2025. The connect
// card used to say "get yours at cloud.ouraring.com/personal-access-tokens",
// which sent a new user to a page where no token can be created — a dead end
// dressed as a setup step, and exactly the bug class the handoff calls "never
// point at a remedy that isn't rendered".

const source = readFileSync("src/components/settings/OuraManager.tsx", "utf8")

// Comments are allowed to quote the old dead-end hint — that is how the reason
// survives. Only what the card actually renders is under test here.
const card = source
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ")

describe("the Oura connect card", () => {
  it("never sends anyone to create a token that cannot be created", () => {
    expect(card).not.toContain("personal-access-tokens")
    expect(card).not.toMatch(/get yours/i)
  })

  it("says the token path is closed to new users", () => {
    expect(card).toMatch(/stopped issuing/i)
  })

  it("says so plainly when this deployment has no OAuth to offer instead", () => {
    // Without OAuth configured there is now no way in at all for a new ring.
    // Silence there would leave the token box looking like the way in.
    expect(source).toMatch(/!hasOauthConfig/)
    expect(card).toMatch(/isn&apos;t set up on this deployment/)
  })
})
