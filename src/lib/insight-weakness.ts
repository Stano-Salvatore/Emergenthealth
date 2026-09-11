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

import { CONFIDENT_N } from "./correlations"

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
    return `Both sides are thin — ${ins.highGroupN} days and ${ins.lowGroupN}. ` +
      `Under ${CONFIDENT_N} a side, no gap is big enough to stand out. More days will settle this, not a bigger difference.`
  }
  if (hThin || lThin) {
    const label = hThin ? ins.highGroupLabel : ins.lowGroupLabel
    const n = hThin ? ins.highGroupN : ins.lowGroupN
    return `Only ${n} day${n === 1 ? "" : "s"} of "${label}" in this window. ` +
      `Under ${CONFIDENT_N}, nothing can stand out, however real it is. This needs more days, not a bigger difference.`
  }
  return `There are enough days here — ${ins.highGroupN} and ${ins.lowGroupN}. ` +
    `The gap is the size chance alone produces, so if something real is going on, it is small.`
}
