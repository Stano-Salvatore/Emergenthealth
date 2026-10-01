// The onboarding's "how it works": what a pattern is, what its badge means,
// and what it is not. Shown before anything is asked, because every later
// step — the questions, the connections, the reminders — is in service of it.
//
// Everything said here has to stay true of the engine: the example is drawn
// with the Insights page's own parts, the badges are its badges, and the
// caveats are ones a real card prints (the weekend badge, the bedtime note,
// the experiment link).

import { DeltaPill, GroupChips, TierBadge, type Tier } from "@/components/insights/InsightParts"
import { EXAMPLE_PATTERN as ex } from "@/lib/onboarding-example"

const TIERS: { tier: Tier; meaning: string }[] = [
  { tier: "strong", meaning: "A bigger gap than shuffling your days at random produces, even allowing for how many things were tested." },
  { tier: "suggestive", meaning: "Bigger than most shuffles produce, but not by enough to rule out luck." },
  { tier: "noise", meaning: "Shuffled days produce gaps this size too. Hidden unless you ask for them." },
]

function ExampleCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        <span className="text-lg leading-none shrink-0" aria-hidden>{ex.emoji}</span>
        <span className="font-semibold text-sm flex-1 min-w-0 leading-snug pt-0.5">{ex.title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <DeltaPill delta={ex.delta} />
          <TierBadge tier={ex.tier} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{ex.finding}</p>
      <GroupChips high={ex.high} low={ex.low} />
    </div>
  )
}

export function PatternsStep() {
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground leading-relaxed">
        Each day becomes one row: the check-in, sleep, habits, coffee, workouts, the calendar, places and more.
        The app sets days with something — late coffee, a workout, a busy calendar — against days without,
        and compares how you slept, felt and recovered. Only your own days, never anyone else&apos;s.
      </p>

      <figure>
        <figcaption className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="rounded border border-border px-1.5 py-0.5">Example</span>
          <span>What a pattern looks like — not your data</span>
        </figcaption>
        <ExampleCard />
      </figure>

      <section aria-labelledby="tiers-heading" className="space-y-3">
        <h2 id="tiers-heading" className="text-sm font-semibold text-foreground">Every pattern is checked against chance</h2>
        <ul className="space-y-3">
          {TIERS.map(({ tier, meaning }) => (
            <li key={tier} className="text-sm text-muted-foreground leading-relaxed">
              <span className="mr-2 inline-block align-[1px]"><TierBadge tier={tier} /></span>
              {meaning}
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-3">
        A pattern means two things went together on your days — not that one caused the other. Cards say when
        weekends or bedtimes could explain a gap, and the ones you can act on come with a way to test them as an
        experiment.
      </p>
    </div>
  )
}
