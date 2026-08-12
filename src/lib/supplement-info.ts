// Pharmacology reference for supplements and common OTC meds the user logs
// (usually as Oura tags). Half-lives are typical adult plasma values from
// standard references — REAL clearance varies with liver enzymes, kidneys,
// sleep, food, alcohol and other medication, so everything here is a guide
// for timing and expectations, never medical advice.
//
// Two kinds of substances behave very differently:
//  - fast/water-soluble things (melatonin, caffeine, vitamin C, painkillers)
//    have meaningful hour-scale half-lives → an "still active" estimate makes
//    sense, like the caffeine tracker;
//  - fat-soluble / stored things (vitamin D, B12, omega-3, creatine) build up
//    over weeks — the daily clock matters far less than consistency.

import { normalizeSupplement, fold } from "@/lib/supplement-normalize"

export interface SupplementInfo {
  /** Plasma elimination half-life in hours, only when a single number is honest. */
  halfLifeH?: number
  /** Plain-words "how long it's with you". */
  duration: string
  /** Best time / with what to take it. */
  timing: string
  /** Interaction or safety note worth knowing. */
  caution?: string
  soluble?: "water" | "fat"
}

const BY_CANONICAL: Record<string, SupplementInfo> = {
  "Vitamin D": {
    soluble: "fat",
    duration: "Builds up over weeks (blood half-life ≈ 2–3 weeks) — a missed day changes nothing",
    timing: "With a fatty meal for absorption; morning or noon",
    caution: "Works together with K2 and magnesium; very high doses deserve a blood test",
  },
  "Vitamin D3 + K2": {
    soluble: "fat",
    duration: "D builds up over weeks; K2 clears faster but the pairing is about long-term balance",
    timing: "With a fatty meal",
  },
  "Vitamin K2": {
    soluble: "fat",
    duration: "MK-7 form stays ≈ 3 days; effects are cumulative",
    timing: "With a fatty meal — pairs naturally with vitamin D",
    caution: "Talk to a doctor first if on blood thinners (warfarin)",
  },
  "Vitamin C": {
    soluble: "water",
    halfLifeH: 2,
    duration: "Peaks in 2–3 h and clears within the day; the body absorbs ~200 mg at a time well",
    timing: "Any time; split doses absorb better than one big one",
    caution: "Helps iron absorb — take with iron, not with expensive urine ambitions (megadoses mostly pass through)",
  },
  "Vitamin B12": {
    soluble: "water",
    duration: "The liver stores years' worth — consistency over months is what matters",
    timing: "Morning; sublingual or with food",
  },
  "B-Complex": {
    soluble: "water",
    duration: "Water-soluble — most of it clears within a day",
    timing: "Morning with food — B vitamins can feel energizing, so avoid late evening",
  },
  "Folate": {
    soluble: "water",
    duration: "Clears within a day; body stores last ~3–4 months",
    timing: "Any time, with food",
  },
  "Biotin": {
    soluble: "water",
    duration: "Clears in ~1 day",
    timing: "Any time",
    caution: "Can skew thyroid and other lab tests — pause a few days before blood work",
  },
  "Vitamin A": {
    soluble: "fat",
    duration: "Liver stores months' worth",
    timing: "With a fatty meal",
    caution: "Fat-soluble — high doses accumulate; keep to sensible amounts",
  },
  "Vitamin E": {
    soluble: "fat",
    duration: "Stays in tissues for days–weeks",
    timing: "With a fatty meal",
  },
  "Magnesium": {
    duration: "Blood level normalizes in ~a day; muscle/bone stores build over weeks",
    timing: "Evening — many find it relaxing and it may help sleep",
    caution: "Too much at once loosens digestion; separate from iron and high-dose zinc by ~2 h",
  },
  "Zinc": {
    duration: "Plasma clears in hours; tissue stores turn over in weeks",
    timing: "With food (on an empty stomach it can cause nausea)",
    caution: "Long-term high doses deplete copper; competes with iron and magnesium for absorption",
  },
  "Iron": {
    duration: "The absorbed dose commits within hours; refilling stores takes months",
    timing: "Morning, ideally on an empty stomach with vitamin C",
    caution: "Coffee, tea, calcium and magnesium block absorption — separate by ~2 h. Every-other-day dosing can absorb better",
  },
  "Calcium": {
    duration: "Blood level is tightly regulated; bone effect is long-term",
    timing: "With food; the body absorbs ~500 mg at a time — split bigger doses",
    caution: "Blocks iron and competes with zinc — separate them",
  },
  "Potassium": {
    soluble: "water",
    duration: "Regulated within hours by the kidneys",
    timing: "With food and water",
  },
  "Selenium": {
    duration: "Builds up with regular intake; a Brazil nut a day is plenty",
    timing: "Any time",
    caution: "The window to too-much is narrower than most minerals — don't stack multiple selenium sources",
  },
  "Omega-3": {
    soluble: "fat",
    duration: "Incorporates into cell membranes over weeks — daily timing is irrelevant, consistency isn't",
    timing: "With a fatty meal (also reduces fishy burps)",
  },
  "Melatonin": {
    halfLifeH: 0.9,
    duration: "Half-life under an hour — mostly gone in 4–5 h",
    timing: "30–60 min before bed; 0.5–1 mg is often enough (more isn't deeper sleep)",
    caution: "It's a timing signal, not a sleeping pill — bright screens after taking it fight it",
  },
  "Creatine": {
    halfLifeH: 3,
    duration: "Plasma clears in hours but muscles saturate over ~3–4 weeks of daily use",
    timing: "Any consistent time daily; with carbs/protein absorbs slightly better",
    caution: "Drink enough water; a 1–2 kg water-weight gain is normal and fine",
  },
  "Probiotics": {
    duration: "Mostly transient guests — days after stopping; regular intake is what maintains the effect",
    timing: "Empty stomach or with a light meal; consistent daily",
  },
  "Collagen": {
    duration: "Amino acids absorb in hours; visible tissue effects take 8+ weeks",
    timing: "Any time; vitamin C helps the body use it",
  },
  "Ashwagandha": {
    duration: "Effects build over 2–4 weeks of daily use",
    timing: "Evening works well (mildly calming for most people)",
    caution: "Cycle it (e.g. 8 weeks on, 2 off); avoid with thyroid meds without medical advice",
  },
  "Turmeric": {
    soluble: "fat",
    duration: "Curcumin clears fast (hours) — piperine (black pepper) extends it many-fold",
    timing: "With a fatty meal + black pepper",
  },
  "CoQ10": {
    soluble: "fat",
    duration: "Half-life ≈ 33 h; steady state after ~a week",
    timing: "With a fatty meal, morning (mildly energizing for some)",
  },
  "Glutamine": {
    halfLifeH: 1,
    duration: "Clears in hours",
    timing: "Post-workout or between meals",
  },
  "Multivitamin": {
    duration: "A mix — water-soluble parts clear daily, fat-soluble parts accumulate",
    timing: "With a meal containing some fat",
    caution: "Contains iron+calcium together in many brands, which fight — a decent diet beats a mediocre multi",
  },
}

// Common OTC meds arrive as free-text tags, not via normalizeSupplement.
const MED_PATTERNS: [RegExp, SupplementInfo][] = [
  [/ibuprofen|brufen|nurofen/, {
    halfLifeH: 2,
    duration: "Half-life ≈ 2 h; pain relief lasts ~4–6 h",
    timing: "With food or milk — never on an empty stomach",
    caution: "Hard on the stomach lining; avoid combining with alcohol; space doses 6–8 h",
  }],
  [/paracetamol|acetaminophen|panadol|paralen/, {
    halfLifeH: 2.5,
    duration: "Half-life ≈ 2–3 h; effect ~4–6 h",
    timing: "With or without food",
    caution: "The daily maximum matters (liver) — and alcohol lowers it. Check combo cold medicines for hidden paracetamol",
  }],
  [/aspirin|acylpyrin|anopyrin/, {
    duration: "Short plasma half-life but the platelet effect lasts days",
    timing: "With food",
    caution: "Blood-thinning effect persists ~a week; avoid with other NSAIDs",
  }],
  [/cetirizin|zyrtec|zodac/, {
    halfLifeH: 8,
    duration: "Half-life ≈ 8 h; one dose covers ~24 h",
    timing: "Evening if it makes you drowsy",
  }],
  [/loratadin|claritin|flonidan/, {
    halfLifeH: 8,
    duration: "With its active metabolite, one dose covers ~24 h",
    timing: "Any time — non-drowsy for most",
  }],
  [/caffeine|kofein/, {
    halfLifeH: 5,
    duration: "Half-life ≈ 5 h — a late-afternoon dose is still half-active at midnight",
    timing: "Before 14:00 protects sleep for most people",
    caution: "Same math as the caffeine tracker uses",
  }],
]

/** Look up pharmacology info for a supplement/med label. Null when unknown. */
export function supplementInfoFor(label: string): SupplementInfo | null {
  const canonical = normalizeSupplement(label)
  if (canonical && BY_CANONICAL[canonical]) return BY_CANONICAL[canonical]
  const folded = fold(label)
  for (const [re, info] of MED_PATTERNS) {
    if (re.test(folded)) return info
  }
  return null
}

/**
 * Fraction of a dose still circulating after `hoursSince`, for substances with
 * an honest single half-life. Null when a decay model doesn't apply (stored /
 * fat-soluble substances).
 */
export function fractionRemaining(info: SupplementInfo, hoursSince: number): number | null {
  if (info.halfLifeH == null || hoursSince < 0) return null
  return Math.pow(0.5, hoursSince / info.halfLifeH)
}

export const PHARMA_DISCLAIMER =
  "Typical adult values — real clearance shifts with sleep, liver, food, alcohol and other medication. A guide, not medical advice."
