import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// `WeatherLog` had one writer: the dashboard widget, in the browser. So the
// column recorded the weather on the days its owner opened the app — and the
// engine read it as though it recorded the weather. A card like "on sunny
// high-UV days readiness averages 72.3 against 57.5 on grey days" was computed
// over the looked-at days alone, and nothing said so.

const cron = readFileSync("src/app/api/cron/weather/route.ts", "utf8")
const widget = readFileSync("src/app/api/weather/route.ts", "utf8")

describe("the nightly weather fill", () => {
  it("is closed to anyone but the scheduler", () => {
    expect(cron).toContain("requireCronSecret(req)")
  })

  it("never overwrites a measurement taken on the spot", () => {
    // The widget stands where the user stands with the browser's own fix; the
    // cron uses wherever their phone last reported from, which may be
    // yesterday's city. The device row wins, always.
    expect(cron).toMatch(/WHERE "WeatherLog"\."source" = 'cron'/)
    expect(cron).toContain("'cron'")
    // And a day the widget writes becomes a measurement from then on, so the
    // fill stops touching it.
    expect(widget).toMatch(/"source" = 'device'/)
  })

  it("corrects its own provisional days", () => {
    // Today's row is written before the day's maximum temperature and UV are
    // settled. Without an UPDATE arm it would stay provisional forever.
    expect(cron).toContain("ON CONFLICT")
    expect(cron).toContain("DO UPDATE SET")
  })

  it("asks only for the days it is missing, and stops at what exists", () => {
    // Open-Meteo hands back ~72 days, not the 92 the parameter allows. Without
    // a floor at the oldest row we have, the job asks for three months every
    // night forever, chasing days that do not exist.
    expect(cron).toMatch(/GREATEST\(/)
    expect(cron).toMatch(/MIN\(to_date\(w\."date"/)
  })

  it("does not mistake a broken query for a user with nothing missing", () => {
    // The first version returned 0 on error, which reads as "no gaps" and
    // silently shrank every backfill to two days. Twice, for two different
    // SQL errors, neither visible from reading the code.
    expect(cron).toMatch(/GAP_QUERY_FAILED = \d+/)
    expect(cron).toContain("gap query failed")
    expect(cron).not.toMatch(/\}\.catch\(\(\) => 0\)/)
  })

  it("survives the two things Postgres insisted on", () => {
    // generate_series with an interval step yields timestamps, so the date
    // cast is required; and a bound integer in `CURRENT_DATE - $1` makes the
    // whole expression an integer, so the lookback goes through make_interval.
    expect(cron).toMatch(/g\.d::date/)
    expect(cron).toMatch(/make_interval\(days =>/)
  })

  it("guesses nobody's location", () => {
    // The phone's last fix, else where the dashboard last measured from. A
    // user who has given neither gets no row rather than a guessed city.
    expect(cron).toContain("locationPoint.findFirst")
    expect(cron).toMatch(/if \(!place\) continue/)
  })

  it("writes nothing for a day the provider had nothing for", () => {
    // A row of nulls would read as "we looked, and it was nothing".
    expect(cron).toMatch(/temperature_2m_max\[i\] == null && daily\.weathercode\[i\] == null/)
  })
})

describe("it is actually scheduled", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] }
  const entry = vercel.crons.find(c => c.path === "/api/cron/weather")

  it("runs daily, before the job that reads the column", () => {
    expect(entry).toBeDefined()
    const hour = Number(entry!.schedule.split(" ")[1])
    const watch = vercel.crons.find(c => c.path === "/api/cron/correlation-watch")!
    // correlation-watch is what sends the "your patterns moved" email; weather
    // has to be in before it reads.
    expect(hour).toBeLessThan(Number(watch.schedule.split(" ")[1]))
  })
})
