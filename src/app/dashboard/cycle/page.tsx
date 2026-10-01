"use client"

// Cycle — periods, phases and what each phase tends to bring.
//
// Off until turned on. Once on: where today sits on a ring of the user's
// own cycle, a one-tap logger, a calendar with predictions drawn only
// forward, every phase explained (food, movement, sleep, medicines), the user's
// own numbers by phase once two cycles are logged, and what the contraception
// means for all of it. Everything is worked out by lib/cycle on the server
// and again here for the calendar, so both see the same cycle.

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { addDaysISO } from "@/lib/local-date"
import {
  AVERAGE_METRICS, PACKS, daysBetween, dayMarks, periodsFrom,
  type CycleDayLog, type CycleSettings, type CycleToday, type DayValue, type Phase, type PhaseAverages,
} from "@/lib/cycle"
import { cycleHeadline } from "@/lib/cycle-text"
import { CONTRACEPTION_GUIDE, DOCTOR_SIGNS, PHASE_GUIDE } from "@/lib/cycle-guide"
import { CycleRing } from "@/components/cycle/CycleRing"
import { CycleCalendar, monthDays } from "@/components/cycle/CycleCalendar"
import { DayLogger } from "@/components/cycle/DayLogger"
import { PhaseGuideList } from "@/components/cycle/PhaseGuideList"
import { CycleSettingsCard } from "@/components/cycle/CycleSettingsCard"
import { PhaseAveragesCard } from "@/components/cycle/PhaseAveragesCard"
import { TempChart } from "@/components/cycle/TempChart"
import { PeriodHistory } from "@/components/cycle/PeriodHistory"

interface CycleData {
  settings: CycleSettings
  visibility: "on" | "suggested" | "off"
  todayStr: string
  logs: CycleDayLog[]
  today: CycleToday
  temps: DayValue[]
  averages: PhaseAverages | null
  ferritin: { value: number; unit: string; date: string; flag: string | null; qualifier: string | null } | null
}

function basisLine(t: CycleToday): string {
  const s = t.stats
  if (s.basis === "personal" && s.range) return `From your last ${s.lengths.length} cycles, ${s.range[0]}–${s.range[1]} days long.`
  if (s.basis === "entered") return `From the ${s.cycleLength} days you entered — after two logged cycles it uses your own.`
  if (s.basis === "personal") return `From your one logged cycle of ${s.cycleLength} days — a second makes it steadier.`
  return "Starting from a typical 28 days — after two logged cycles it uses your own."
}

/** The user's own day ranges for each phase, for the guide's headers. */
function phaseDays(t: CycleToday): Partial<Record<Phase, string>> {
  const L = t.stats.cycleLength
  const P = t.stats.periodLength
  const O = t.mode === "natural" ? L - t.stats.lutealLength : null
  const range = (a: number, b: number) => a >= b ? `Day ${a}` : `Days ${a}–${b}`
  const out: Partial<Record<Phase, string>> = { menstrual: range(1, P) }
  if (O != null && O - 2 > P) {
    out.follicular = range(P + 1, O - 2)
    out.ovulation = range(O - 1, O + 1)
    out.luteal = range(O + 2, L)
  }
  return out
}

export default function CyclePage() {
  const [data, setData] = useState<CycleData | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [month, setMonth] = useState<string | null>(null)
  const [quick, setQuick] = useState(false)

  const load = useCallback(() => {
    return fetch("/api/cycle")
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: CycleData) => { setData(d); setFailed(false) })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => { load() }, [load])

  const logsByDay = useMemo(() => new Map((data?.logs ?? []).map(l => [l.day, l])), [data])
  const viewMonth = month ?? data?.todayStr.slice(0, 7) ?? ""
  const marks = useMemo(
    () => data && viewMonth ? dayMarks(monthDays(viewMonth), data.logs, data.today, data.settings) : {},
    [data, viewMonth],
  )
  const history = useMemo(() => periodsFrom(data?.logs ?? []), [data])

  if (!data) {
    return (
      <div className="max-w-2xl mx-auto py-10 text-center text-sm text-muted-foreground">
        {failed ? <>The cycle couldn&apos;t load. <button className="underline" onClick={() => load()}>Try again</button></> : <Loader2 className="h-5 w-5 animate-spin mx-auto" />}
      </div>
    )
  }

  if (data.visibility !== "on") {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold">🌸 Cycle</h1>
          <p className="text-sm text-muted-foreground mt-1">Your period, your phases, and what each one tends to bring.</p>
        </div>
        <Card>
          <CardContent className="pt-5 space-y-4">
            <ul className="text-sm space-y-1.5">
              <li>🩸 Where you are today, and when the next period is likely</li>
              <li>🌗 Every phase explained — what to expect, food, movement, sleep and medicines</li>
              <li>💊 What the pill or a coil means for it, and pill reminders that skip the break week</li>
              <li>📈 Your own sleep, HRV and mood in each phase, once two cycles are logged</li>
              <li>🏠 A line on the home page on period days and two days before</li>
            </ul>
            <p className="text-xs text-muted-foreground">Only you see it, and you can turn it off any time. Predictions are estimates, never contraception.</p>
            <CycleSettingsCard settings={data.settings} today={data.todayStr} setup onSaved={() => load()} />
          </CardContent>
        </Card>
      </div>
    )
  }

  const t = data.today
  const head = cycleHeadline(t, data.settings)
  const day = selected ?? data.todayStr
  const ovulationDay = t.ovulation && t.currentStart ? daysBetween(t.currentStart, t.ovulation) + 1 : null
  const ringCenter = t.mode === "pack" && t.pack ? `${t.pack.day}` : t.cycleDay != null ? `Day ${t.cycleDay}` : "—"
  const ringSub = t.mode === "pack" ? (t.pack?.active ? "pill day" : "break week")
    : t.phase ? (t.premenstrual && t.phase === "luteal" ? "premenstrual" : PHASE_GUIDE[t.phase].name.toLowerCase()) : "of your cycle"

  async function quickLog(flow: "medium" | "none") {
    setQuick(true)
    await fetch("/api/cycle/day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: data!.todayStr, flow }),
    }).catch(() => null)
    await load()
    setQuick(false)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">🌸 Cycle</h1>
        <p className="text-sm text-muted-foreground mt-1">{CONTRACEPTION_GUIDE[data.settings.contraception].name}</p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <CycleRing
              cycleLength={t.stats.cycleLength}
              periodLength={t.stats.periodLength}
              ovulationDay={t.mode === "natural" ? ovulationDay : null}
              cycleDay={t.mode === "pack" ? null : t.cycleDay}
              center={ringCenter}
              sub={ringSub}
              pack={t.mode === "pack" && t.pack && data.settings.pack
                ? { active: PACKS[data.settings.pack.kind].active, length: t.pack.length, day: t.pack.day }
                : null}
            />
            <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left">
              <p className="text-lg font-semibold">{head.title}</p>
              {head.detail && <p className="text-sm text-muted-foreground">{head.detail}</p>}
              {t.mode !== "pack" && t.currentStart && <p className="text-[11px] text-muted-foreground">{basisLine(t)}{t.stats.variesBy != null && t.stats.variesBy >= 8 ? ` They varied by ${t.stats.variesBy} days, so the dates are rougher.` : ""}</p>}
              {t.lateBy > 0 && data.settings.contraception === "none" && (
                <p className="text-[11px] text-muted-foreground">{CONTRACEPTION_GUIDE.none.notes[0]}</p>
              )}
              <div className="flex flex-wrap gap-2 justify-center sm:justify-start pt-1">
                {/* On the pill a bleed is a withdrawal bleed, not a period. */}
                {t.periodOngoing
                  ? <Button size="sm" variant="outline" disabled={quick} onClick={() => quickLog("none")}>{t.mode === "pack" ? "Bleeding stopped" : "Period ended"}</Button>
                  : <Button size="sm" disabled={quick} onClick={() => quickLog("medium")}>{t.mode === "pack" ? "Bleeding started today" : "Period started today"}</Button>}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-3">Predictions are estimates from what you log — never a method of contraception.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Log a day</CardTitle></CardHeader>
        <CardContent>
          <DayLogger
            day={day}
            today={data.todayStr}
            log={logsByDay.get(day)}
            earliest={addDaysISO(data.todayStr, -400)}
            onDay={d => { setSelected(d); setMonth(d.slice(0, 7)) }}
            onSaved={() => load()}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <CycleCalendar
            month={viewMonth}
            marks={marks}
            logs={logsByDay}
            today={data.todayStr}
            selected={day}
            onSelect={d => setSelected(d)}
            onMonth={setMonth}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">The phases</CardTitle></CardHeader>
        <CardContent>
          <PhaseGuideList current={t.phase} premenstrual={t.premenstrual} days={phaseDays(t)} mode={t.mode} ferritin={data.ferritin} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Your phases in your data</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {data.averages && <PhaseAveragesCard averages={data.averages} metrics={AVERAGE_METRICS} />}
          {t.currentStart && <TempChart temps={data.temps} start={t.currentStart} ovulation={t.ovulation} confirmed={t.ovulationConfirmed} />}
          {data.temps.length === 0 && (
            <p className="text-[11px] text-muted-foreground">With an Oura ring, its night temperature shows the rise after ovulation here and sharpens the estimate.</p>
          )}
        </CardContent>
      </Card>

      {data.settings.contraception !== "none" && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{CONTRACEPTION_GUIDE[data.settings.contraception].name}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{CONTRACEPTION_GUIDE[data.settings.contraception].summary}</p>
            <ul className="space-y-1">
              {CONTRACEPTION_GUIDE[data.settings.contraception].notes.map(n => (
                <li key={n} className="text-sm leading-snug flex gap-2"><span className="text-muted-foreground">·</span><span>{n}</span></li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Past periods</CardTitle></CardHeader>
        <CardContent><PeriodHistory periods={history.periods} between={history.between} /></CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <details>
            <summary className="text-sm font-semibold cursor-pointer select-none">When to talk to a doctor</summary>
            <ul className="space-y-1 mt-3">
              {DOCTOR_SIGNS.map(s => <li key={s} className="text-sm leading-snug flex gap-2"><span className="text-muted-foreground">·</span><span>{s}</span></li>)}
            </ul>
            <p className="text-[11px] text-muted-foreground mt-3">
              The <Link href="/dashboard/report" className="underline">health report</Link> includes your cycle, ready to show a doctor.
            </p>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Settings</CardTitle></CardHeader>
        <CardContent>
          <CycleSettingsCard key={JSON.stringify(data.settings)} settings={data.settings} today={data.todayStr} setup={false} onSaved={() => load()} />
        </CardContent>
      </Card>
    </div>
  )
}
