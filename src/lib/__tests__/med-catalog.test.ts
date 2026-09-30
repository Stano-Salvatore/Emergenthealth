import { describe, it, expect } from "vitest"
import { supplementInfoFor } from "@/lib/supplement-info"

// "Stillnox" logged at 22:28 showed no half-life and never reached Body
// load: zolpidem wasn't in the table at all. The table now covers the sleep
// aids, painkillers, antihistamines and everyday prescriptions people
// actually log, by generic name and local brand.

const h = (label: string) => supplementInfoFor(label)?.halfLifeH

describe("the medication table", () => {
  it("knows zolpidem, however the tag spells it", () => {
    expect(h("Stillnox")).toBe(2.5)
    expect(h("Stilnox 10mg")).toBe(2.5)
    expect(h("zolpidem")).toBe(2.5)
    expect(h("Hypnogen")).toBe(2.5)
  })

  it("covers sleep aids and anxiolytics", () => {
    expect(h("Imovane")).toBe(5)       // zopiclone
    expect(h("Rivotril")).toBe(35)     // clonazepam
    expect(h("Lexaurin")).toBe(20)     // bromazepam
    expect(h("Lorafen")).toBe(12)      // lorazepam
    expect(h("Trittico")).toBe(7)      // trazodone
    expect(h("Ketilept 25")).toBe(7)   // quetiapine
  })

  it("covers painkillers beyond ibuprofen", () => {
    expect(h("Novalgin")).toBe(3)      // metamizole
    expect(h("Voltaren")).toBe(2)      // diclofenac
    expect(h("Tramal")).toBe(6)        // tramadol
    expect(h("Aulin")).toBe(4)         // nimesulide
    expect(h("Ketonal")).toBe(2)       // ketoprofen
  })

  it("keeps the specific antihistamine ahead of the one its name contains", () => {
    expect(h("Aerius")).toBe(27)
    expect(h("desloratadin")).toBe(27) // not loratadine's 8
    expect(h("Bilaxten")).toBe(14)
    expect(h("Telfast")).toBe(14)
  })

  it("warns about tramadol alongside an SSRI", () => {
    expect(supplementInfoFor("Tralgit")?.caution).toMatch(/serotonin/i)
  })

  it("gives sertraline its own half-life", () => {
    expect(h("Zoloft")).toBe(26)
    expect(h("sertralin")).toBe(26)
  })

  it("leaves thyroid hormone without an hour-scale decay", () => {
    const info = supplementInfoFor("Euthyrox 50")
    expect(info).not.toBeNull()
    expect(info?.halfLifeH).toBeUndefined()
  })

  it("does not break the brands that were already there", () => {
    expect(h("Elicea")).toBe(30)
    expect(h("Atarax")).toBe(20)
    expect(h("Ibalgin 400")).toBe(2)
    expect(h("Claritin")).toBe(8)
  })
})
