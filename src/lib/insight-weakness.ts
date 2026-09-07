// Why a card reads "Could be chance" — said in days, not in statistics.
//
// The complaint this answers arrived as "I have only 10 insights in 1 year".
// The other forty-two existed the whole time, tiered honestly and hidden
// behind the weak toggle, and the app never said WHY any of them were weak.
// A card that just reads "Could be chance" leaves two very different stories
// indistinguishable:
//
//   · seven hot days against fifty-seven — no effect, however real, clears a
//     permutation test from a group of seven. The verdict is about the DATA.
//   · forty days against forty-one, and the gap between them is about what
//     shuffling the days produces. The verdict is about the EFFECT.
//
// The first is an instruction (keep logging; the window decides this later).
// The second is an answer (if it's real, it's small). Telling them apart is
// one comparison against the same bound the engine itself uses: compareGroups
// marks a result `confident` only when both sides have 10 days, so 10 is the
// number the message names — not a new threshold, the existing one made
// visible.
//
// Deliberately NOT here: "about 15 more days would settle it". That is a
// power calculation, and an honest one needs an effect size we'd have to
// assume. Naming the count and the bar is what the data supports.

/** The engine's own confidence bound (compareGroups: both sides >= 10). */
const CONFIDENT_N = 10

export interface WeaknessInput {
  tier?: "strong" | "suggestive" | "noise"
  highGroupLabel: string
  lowGroupLabel: string
  highGroupN: number
  lowGroupN: number
}

/**
 * One plain sentence explaining a weak card, or null for anything that isn't
 * weak — the strong tiers explain themselves.
 */
export function weaknessReason(ins: WeaknessInput): string | null {
  if (ins.tier !== "noise") return null

  const hThin = ins.highGroupN < CONFIDENT_N
  const lThin = ins.lowGroupN < CONFIDENT_N

  if (hThin && lThin) {
    return `Both sides are thin — ${ins.highGroupN} and ${ins.lowGroupN} days. ` +
      `Under ${CONFIDENT_N} days a side, nothing clears the chance test. More days decide this, not a bigger effect.`
  }
  if (hThin || lThin) {
    const label = hThin ? ins.highGroupLabel : ins.lowGroupLabel
    const n = hThin ? ins.highGroupN : ins.lowGroupN
    return `The “${label}” side has only ${n} day${n === 1 ? "" : "s"} in this window — ` +
      `under ${CONFIDENT_N}, no difference can clear the chance test, however real the effect. This needs more days, not a bigger one.`
  }
  return `Sample size isn't the problem here — ${ins.highGroupN} vs ${ins.lowGroupN} days. ` +
    `The gap itself is about what chance produces; if there's a real effect, it's small.`
}
