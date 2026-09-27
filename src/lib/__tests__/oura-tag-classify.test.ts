import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { classifyOuraTag } from "@/lib/oura-tag-classify"

// The spirits rule matched "rum" anywhere in a word, so "Ferrum" (iron) and
// "Centrum" (a multivitamin) were 40 ml of spirits: every morning's iron tag
// wrote 12.6 g of ethanol into the intake log, the correlation engine counted
// each iron day as a drinking day, and the supplement vanished from every
// place that lists what was taken.

describe("classifyOuraTag", () => {
  it.each([
    "Ferrum",
    "Ferrum Lek",
    "Centrum",
    "Magnesium",
    "Vitamin C",
    "Kavakava",
  ])("a supplement is a supplement: %s", label => {
    expect(classifyOuraTag(label).kind).toBe("med")
  })

  it("a substance the canon knows is never alcohol, whatever it contains", () => {
    // "shot" and "mineral" were bare substrings too.
    expect(classifyOuraTag("Zinc shot").kind).toBe("med")
    expect(classifyOuraTag("Calcium mineral complex").kind).toBe("med")
    expect(classifyOuraTag("Iron shots of ginger").kind).toBe("med")
    expect(classifyOuraTag("Vitamin C cider vinegar").kind).toBe("med")
  })

  it.each([
    ["Collagen coffee", "coffee"],
    ["Coffee + collagen", "coffee"],
    ["Matcha with ashwagandha", "matcha"],
    ["Magnesium water", "water"],
  ])("a drink with a supplement in it is still the drink: %s", (label, kind) => {
    // The sync deletes the intake and caffeine rows of any tag that is not a
    // drink, so calling these supplements would erase real coffee.
    expect(classifyOuraTag(label).kind).toBe(kind)
  })

  it.each([
    ["Rum", "spirits"],
    ["rum and coke", "spirits"],
    ["Gin tonic", "spirits"],
    ["Vodka", "spirits"],
    ["Spirits", "spirits"],
    ["Beer", "beer"],
    ["Mineral water", "sparkling"],
    ["Minerálka", "sparkling"],
    ["Káva", "coffee"],
    ["Coffee", "coffee"],
    ["Water 500ml", "water"],
  ])("the drinks still read: %s", (label, kind) => {
    expect(classifyOuraTag(label).kind).toBe(kind)
  })

  it("keeps an explicit volume", () => {
    expect(classifyOuraTag("Water 500ml").ml).toBe(500)
  })
})

describe("the Oura sync repairs rows the old classifier wrote", () => {
  // Deterministic ids made the wrong rows permanent: a tag re-synced as a
  // supplement skipped the upsert and left its spirits row in place.
  const sync = readFileSync("src/lib/oura-sync.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

  it("removes a mirrored intake row when the tag is no longer a drink", () => {
    expect(sync).toMatch(/intakeLog\.deleteMany\([^)]*`oura_\$\{id\}`/)
    expect(sync).toMatch(/caffeineLog\.deleteMany\([^)]*`oura_caf_\$\{id\}`/)
  })
})
