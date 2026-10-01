import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { bodyStrain, STRAIN_METRICS } from "@/lib/body-strain"
import { detectEach, type Anomaly, type DayValue } from "@/lib/anomalies"
import { lintSentence, describeProblems } from "./insight-lint"
import { anomalyPush } from "@/lib/anomaly-push"

const NIGHT = "2026-10-01"

/** A concerning one-metric anomaly on the night, as detectEach reports it. */
function sign(metric: string, label: string, z: number, runLength = 1, date = NIGHT): Anomaly {
  return {
    metric, label, emoji: "", unit: "", value: 0, baseline: 0, z,
    direction: z > 0 ? "above" : "below",
    concerning: true, runLength, date, summary: "",
  }
}

const ALL_MEASURED = [...STRAIN_METRICS]
const night = (over: Partial<{ measured: string[]; readiness: number | null; readinessLow: boolean }> = {}) => ({
  date: NIGHT, measured: ALL_MEASURED, readiness: null, readinessLow: false, ...over,
})

function steady(days: number, value: number, wobble: number): DayValue[] {
  const offset = [wobble, -wobble, 0]
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    value: value + offset[i % 3],
  }))
}
const withNight = (s: DayValue[], value: number) => [...s, { date: NIGHT, value }]

describe("bodyStrain", () => {
  it("reads the 1 Oct night — SpO₂ 93.7 and 70 minutes to sleep, everything else usual — as major strain", () => {
    // The night Oura called "major signs of strain" while the illness
    // composite stayed silent: none of its four parts had moved.
    const raw = detectEach({
      restingHR: withNight(steady(28, 52, 1.5), 52.1),
      hrv: withNight(steady(28, 85, 8), 89),
      breathingRate: withNight(steady(28, 15.3, 0.3), 15.25),
      skinTemp: withNight(steady(28, 0, 0.15), 0.04),
      spo2: withNight(steady(28, 97, 0.6), 93.7),
      sleepLatency: withNight(steady(28, 25, 10), 70),
      sleepEfficiency: withNight(steady(28, 90, 2), 84),
      readinessScore: withNight(steady(28, 78, 5), 75),
    })
    const s = bodyStrain(raw, night({ readiness: 75 }))!
    expect(s.level).toBe("major")
    expect(s.signs.map(x => x.metric)).toEqual(expect.arrayContaining(["spo2", "sleepLatency"]))
    expect(s.signs.map(x => x.metric)).not.toContain("restingHR")
    expect(s.summary).toMatch(/Readiness looks typical at 75, but blood oxygen/)
    expect(s.summary).toContain("time to fall asleep")
  })

  it("is none when every measured signal sat in its usual band", () => {
    const s = bodyStrain([], night({ readiness: 82 }))!
    expect(s.level).toBe("none")
    expect(s.signs).toEqual([])
    expect(s.summary).toContain("82")
  })

  it("is null when the night measured none of the strain signals — absent is not calm", () => {
    expect(bodyStrain([], night({ measured: [] }))).toBeNull()
    expect(bodyStrain([], night({ measured: ["steps", "sleepScore"] }))).toBeNull()
  })

  it("counts only the night being judged: a metric whose newest reading is older says nothing about last night", () => {
    const s = bodyStrain([sign("spo2", "Blood oxygen", -5, 1, "2026-09-27")], night())!
    expect(s.level).toBe("none")
  })

  it("ignores helpful shifts and metrics that are not strain signals", () => {
    const helpful = { ...sign("hrv", "HRV", 3), direction: "above" as const, concerning: false }
    const steps = sign("steps", "Steps", -3)
    expect(bodyStrain([helpful, steps], night())!.level).toBe("none")
  })

  it("one ordinary body sign is minor; one sleep sign on its own is not strain", () => {
    expect(bodyStrain([sign("hrv", "HRV", -2.3)], night())!.level).toBe("minor")
    expect(bodyStrain([sign("sleepLatency", "Time to fall asleep", 2.4)], night())!.level).toBe("none")
    expect(bodyStrain([sign("sleepLatency", "Time to fall asleep", 2.4), sign("sleepEfficiency", "Sleep efficiency", -2.2)], night())!.level).toBe("minor")
  })

  it("two body signs on one night, or one held for days alongside another, is major", () => {
    expect(bodyStrain([sign("restingHR", "Resting heart rate", 2.5), sign("hrv", "HRV", -2.4)], night())!.level).toBe("major")
    const held = bodyStrain([sign("restingHR", "Resting heart rate", 1.4, 4), sign("sleepEfficiency", "Sleep efficiency", -2.1)], night())!
    expect(held.level).toBe("major")
    expect(held.summary).toMatch(/held for 4 nights|4 nights/)
  })

  it("the infection pattern is always major and says so", () => {
    const raw = [
      sign("skinTemp", "Skin temperature", 2.5),
      sign("breathingRate", "Breathing rate", 2.2),
      sign("restingHR", "Resting heart rate", 2.1),
    ]
    const s = bodyStrain(raw, night())!
    expect(s.level).toBe("major")
    expect(s.illness).toBe(true)
    expect(s.summary).toMatch(/start of an infection/)
  })

  it("names a low readiness as low rather than typical", () => {
    const s = bodyStrain([sign("hrv", "HRV", -2.5)], night({ readiness: 58, readinessLow: true }))!
    expect(s.summary).toMatch(/^Readiness is down at 58/)
    expect(s.summary).toContain("HRV")
  })

  it("every sentence it can write reads — an observation, no verdict, no statistics words", () => {
    const cases: Anomaly[][] = [
      [],
      [sign("hrv", "HRV", -2.5)],
      [sign("spo2", "Blood oxygen", -5), sign("sleepLatency", "Time to fall asleep", 3.5), sign("sleepEfficiency", "Sleep efficiency", -2.5)],
      [sign("restingHR", "Resting heart rate", 1.4, 4), sign("hrv", "HRV", -1.3, 4)],
      [sign("skinTemp", "Skin temperature", 2.5), sign("breathingRate", "Breathing rate", 2.2), sign("restingHR", "Resting heart rate", 2.1), sign("hrv", "HRV", -2.1)],
    ]
    for (const raw of cases) {
      for (const n of [night(), night({ readiness: 75 }), night({ readiness: 58, readinessLow: true })]) {
        const s = bodyStrain(raw, n)!
        const problems = lintSentence(s.summary)
        expect(problems, describeProblems("body strain", s.summary, problems)).toEqual([])
      }
    }
  })
})

describe("wiring", () => {
  const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

  it("the scan computes it from the raw anomalies and the vitals night", () => {
    const src = strip("src/lib/anomaly-scan.ts")
    expect(src).toMatch(/bodyStrain\(/)
    expect(src).toMatch(/strain/)
  })

  it("every reader of the scan carries it: card, insights API, brief, Emergy and the push", () => {
    expect(strip("src/components/dashboard/VitalsCard.tsx")).toMatch(/scan\.strain/)
    expect(strip("src/app/api/anomalies/route.ts")).toMatch(/strain/)
    expect(strip("src/app/api/briefing/route.ts")).toMatch(/strain/)
    expect(strip("src/lib/claude.ts")).toMatch(/strain/)
    expect(strip("src/app/api/cron/anomaly-watch/route.ts")).toMatch(/strain/)
  })
})

describe("anomalyPush", () => {
  const strainOf = (raw: Anomaly[]) => bodyStrain(raw, night({ readiness: 75 }))
  const withSummary = (a: Anomaly, summary: string) => ({ ...a, summary, emoji: "•" })

  it("a major night pushes the strain sentence, not two metric lines", () => {
    const raw = [
      withSummary(sign("spo2", "Blood oxygen", -3.7), "Blood oxygen is 3.3% below your usual 97%"),
      withSummary(sign("sleepLatency", "Time to fall asleep", 3), "Time to fall asleep is 45min above"),
    ]
    const p = anomalyPush(raw, strainOf(raw))!
    expect(p.title).toContain("Major signs of strain")
    expect(p.body).toMatch(/^Readiness looks typical at 75, but blood oxygen/)
  })

  it("a minor night keeps the metric lines", () => {
    const raw = [withSummary(sign("hrv", "HRV", -2.3, 2), "HRV is 12ms below")]
    const p = anomalyPush(raw, strainOf(raw))!
    expect(p.title).toContain("Off your baseline")
    expect(p.body).toBe("HRV is 12ms below")
  })

  it("does not re-word a run already mentioned: nothing new in the strain, no strain push", () => {
    const raw = [
      withSummary(sign("restingHR", "Resting heart rate", 2.5, 2), "Resting heart rate up"),
      withSummary(sign("hrv", "HRV", -2.4, 2), "HRV down"),
    ]
    const steps = withSummary({ ...sign("steps", "Steps", -3), date: NIGHT }, "Steps down")
    const p = anomalyPush([steps], strainOf(raw))!
    expect(p.body).toBe("Steps down")
  })

  it("the night question still goes out on its own", () => {
    const raw = [withSummary(sign("hrv", "HRV", -3.5), "HRV is 20ms below your usual 60ms (40ms)"), withSummary(sign("spo2", "Blood oxygen", -4), "Blood oxygen low")]
    const p = anomalyPush(raw, strainOf(raw))!
    expect(p.question).toBe(true)
    expect(p.body).toMatch(/Did something happen yesterday/)
  })

  it("nothing worth saying, nothing pushed", () => {
    expect(anomalyPush([], null)).toBeNull()
  })
})
