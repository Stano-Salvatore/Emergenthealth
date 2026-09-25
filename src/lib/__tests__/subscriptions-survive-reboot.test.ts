import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// Android throws away Play Services subscriptions on reboot and app update,
// and nothing in the app noticed: the Settings card went on saying "On —
// segments arrive each morning" while the Sleep API delivered nothing. That
// is how the owner's first tracked night produced zero segments and the card
// kept smiling. Same story for the travel-mode transitions. The boot
// receiver already re-arms alarms, the head, and both services — these two
// subscriptions were the ones it forgot.
//
// These greps read Java. CI compiles it; this pins the shape: the boot path
// re-subscribes from the stored flags, a failed re-subscribe turns the flag
// OFF so the card cannot claim a dead subscription is alive, and both the
// plugin and the receivers build their PendingIntents in ONE place so the
// request codes can never quietly diverge.

const java = (f: string) =>
  readFileSync(`android-widget/${f}`, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")

describe("the boot receiver re-arms both Play Services subscriptions", () => {
  const boot = java("HeadBootReceiver.java")
  it("sleep", () => expect(boot).toMatch(/EmergySleepReceiver\.resubscribe\(/))
  it("travel modes", () => expect(boot).toMatch(/EmergyActivityReceiver\.resubscribe\(/))
})

describe("a re-subscribe that cannot succeed turns its own flag off", () => {
  it("sleep checks the permission and downgrades the flag on failure", () => {
    const s = java("EmergySleepReceiver.java")
    expect(s).toMatch(/static void resubscribe\(/)
    expect(s).toMatch(/ACTIVITY_RECOGNITION/)
    expect(s).toMatch(/putBoolean\(KEY_TRACKING, false\)/)
  })
  it("transitions do the same", () => {
    const s = java("EmergyActivityReceiver.java")
    expect(s).toMatch(/static void resubscribe\(/)
    expect(s).toMatch(/ACTIVITY_RECOGNITION/)
    expect(s).toMatch(/putBoolean\(KEY_TRACKING, false\)/)
  })
})

describe("one PendingIntent definition per subscription", () => {
  it("the plugin borrows the receivers' pending intents instead of rebuilding them", () => {
    const plugin = java("EmergyBubblePlugin.java")
    expect(plugin).toMatch(/EmergySleepReceiver\.pendingIntent\(/)
    expect(plugin).toMatch(/EmergyActivityReceiver\.pendingIntent\(/)
    // The literal request codes may live only where the intent is built.
    expect(plugin).not.toMatch(/920009|920010/)
  })
})

describe("the settings card shows what is stuck on the phone", () => {
  it("queued sleep segments are visible when they have not uploaded", () => {
    const card = readFileSync("src/components/settings/PhoneSensorsCard.tsx", "utf8")
    expect(card).toMatch(/queuedSleep/)
  })
})
