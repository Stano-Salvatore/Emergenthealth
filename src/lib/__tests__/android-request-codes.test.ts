import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"

// Two alarms shared request code 920007 — `EmergyWakeService.RESTART_REQUEST`
// and `HeadAlarmReceiver.WATCHDOG_REQUEST`, both broadcasting to the same
// receiver. A PendingIntent is identified by request code and target, NOT by
// the extras and not by the action unless you ask for that comparison, so the
// two were one PendingIntent that happened to behave because their actions
// differed. Give the wake restart the watchdog's action, drop an action from
// either, or call cancel() on the wrong one, and cancelling the watchdog
// cancels the wake restart instead.
//
// Nothing about that looks wrong in a diff, nothing throws, and no test failed.
// The phone simply stops listening one day. It survived a full audit twice —
// it is written down as A12 in `docs/audit-2026-09-15.md` — because reading two
// files and noticing they share a magic number is exactly what review is worst
// at and a grep is best at.
//
// The rule: a code may repeat inside ONE file, because a component setting and
// later cancelling its own alarm is meant to reuse it (EmergyBubblePlugin does
// this with 920010). Across two files it is a collision, because two
// components cannot both own one PendingIntent.

const NATIVE_DIR = "android-widget"

// The block this app allocates from. Deliberately narrow: a bare number in
// Java is usually not an alarm, and a guard that fails on a timeout constant
// gets deleted rather than fixed.
const CODE = /\b9200\d\d\b/g

const nativeFiles = (): string[] =>
  readdirSync(NATIVE_DIR)
    .filter(f => f.endsWith(".java"))
    .sort()

// Comments go first, and this is not fastidiousness: the very comment
// explaining why the watchdog no longer uses 920007 contains "920007", so the
// first version of this guard failed on the fix for the bug it was written to
// catch. A guard that punishes you for writing down the history is one nobody
// can live with, and the way it fails — pointing at the right file for the
// wrong reason — is worse than not having it.
const code = (file: string): string =>
  readFileSync(`${NATIVE_DIR}/${file}`, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")

describe("Android PendingIntent request codes", () => {
  // If the block moves or the sources do, this guard silently stops covering
  // anything. Better to be told it found nothing than to read a green tick.
  it("can still see the native sources", () => {
    const files = nativeFiles()
    expect(
      files.length,
      `No .java files under ${NATIVE_DIR}/ — the native sources moved, and this guard is checking nothing.`,
    ).toBeGreaterThan(5)

    const total = files.flatMap(f => code(f).match(CODE) ?? [])
    expect(
      total.length,
      `No 9200xx codes found in ${NATIVE_DIR}/. Either the allocation block changed — in which case ` +
        "point CODE at the new one — or this guard is now decorative.",
    ).toBeGreaterThan(5)
  })

  it("are not shared between two components", () => {
    const owners = new Map<string, Set<string>>()

    for (const file of nativeFiles()) {
      for (const found of code(file).match(CODE) ?? []) {
        if (!owners.has(found)) owners.set(found, new Set())
        owners.get(found)!.add(file)
      }
    }

    const shared = [...owners.entries()]
      .filter(([, files]) => files.size > 1)
      .map(([found, files]) => `${found} in ${[...files].sort().join(" and ")}`)

    expect(
      shared,
      `Two components use the same request code: ${shared.join("; ")}. A PendingIntent is identified by ` +
        "its request code and target, not by its action or extras, so these are one PendingIntent wearing " +
        "two names — cancelling one cancels the other, and updating one rewrites the other's extras. " +
        "Give the newer of the two its own code from the 9200xx block.",
    ).toEqual([])
  })
})
