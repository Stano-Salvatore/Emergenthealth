import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

// A drink is two rows: the intake, and — for anything caffeinated — a caffeine
// entry at the same instant under the shared `intake_<id>`, so deleting the
// drink removes its dose.
//
// `recordDrink` exists to be the only place that knows that. It was written
// for the chat paths and stopped there: the Intake tab, the food analyser, the
// widget and the MCP tool each kept a copy, six in all, and they came apart
// exactly where copies do.
//
//   Four swallowed the mirror's failure with `.catch(() => null)`, so a coffee
//   whose caffeine row failed to write looked identical to a coffee with no
//   caffeine in it. Three coffees in this database have no dose attached and
//   nothing anywhere records why.
//
//   The estimate read whatever the note said. The widget's note names the
//   place, so a café called Espresso House would have rewritten every drink
//   bought there as a shot.
//
// This is the guard, and it is deliberately repo-wide rather than a list of
// known files: the failure mode is a NEW writer, and a hand-maintained list
// cannot see one. (The same weakness let `pulseWaveVelocity` ship unread —
// see oura-new-endpoints.test.ts, which now derives its list too.)

/**
 * The writer itself, plus the three places a row legitimately has no partner:
 * the Oura sync (mirrors the ring's own drink tags, keyed `oura_*`), the
 * Caffeine tab (a dose with no drink — a pill, a gel, an energy drink), and
 * the demo seeder.
 */
const ALLOWED = new Set([
  "src/lib/intake-write.ts",
  "src/lib/oura-sync.ts",
  "src/app/api/caffeine/route.ts",
  "src/app/api/admin/seed-demo/route.ts",
])

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__" && entry !== "node_modules") sourceFiles(full, out)
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const FILES = sourceFiles("src")

describe("one writer for a drink", () => {
  it("nothing else creates an IntakeLog", () => {
    const offenders = FILES.filter(f =>
      !ALLOWED.has(f) && /prisma\.intakeLog\.(create|createMany|upsert)\(/.test(readFileSync(f, "utf8")))
    expect(offenders, `these write a drink without its caffeine — call recordDrink:\n${offenders.join("\n")}`)
      .toEqual([])
  })

  it("nothing else creates a CaffeineLog", () => {
    const offenders = FILES.filter(f =>
      !ALLOWED.has(f) && /prisma\.caffeineLog\.(create|createMany|upsert)\(/.test(readFileSync(f, "utf8")))
    expect(offenders, `these mirror caffeine by hand — call recordDrink or resyncDrinkCaffeine:\n${offenders.join("\n")}`)
      .toEqual([])
  })

  it("never swallows a failed mirror", () => {
    // `.catch(() => null)` on the caffeine write is the specific line that
    // turned three lost doses into three unexplained gaps.
    const writer = readFileSync("src/lib/intake-write.ts", "utf8")
    const mirror = writer.slice(writer.indexOf("async function mirrorCaffeine"))
    expect(mirror.slice(0, 800)).toContain("console.error")
    expect(mirror.slice(0, 800)).not.toMatch(/catch\(\(\)\s*=>\s*null\)/)
  })

  it("tells a caller when the dose did not record", () => {
    // Saved drink, missing dose, and a caller with a sentence to say should
    // say it — silence here reads as "this coffee had no caffeine".
    const writer = readFileSync("src/lib/intake-write.ts", "utf8")
    expect(writer).toContain("caffeineMirrorFailed")
  })

  it("lets the estimate read the drink and not the room", () => {
    // estimateCaffeine matches "espresso", "latte", "cold brew" in the label.
    // The widget and log_usual put the place name in the note, so both must
    // hand the estimate something narrower.
    const writer = readFileSync("src/lib/intake-write.ts", "utf8")
    expect(writer).toContain("caffeineLabel")
    for (const f of ["src/lib/claude.ts", "src/app/api/widget/log/route.ts"]) {
      const src = readFileSync(f, "utf8")
      if (!src.includes("@ ${place.name}")) continue
      expect(src, `${f} puts the place in the note; it must pass caffeineLabel`).toContain("caffeineLabel")
    }
  })
})
