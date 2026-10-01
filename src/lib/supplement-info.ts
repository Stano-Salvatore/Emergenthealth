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

// Medications arrive as free-text tags, not via normalizeSupplement. Slovak
// brand names are matched alongside the international generic names.
const MED_PATTERNS: [RegExp, SupplementInfo][] = [
  // ── Sleep aids and anxiolytics ──
  [/zolpidem|stil+nox|hypnogen|sanval|ambien/, {
    halfLifeH: 2.5,
    duration: "Half-life ≈2.5 h — works within 15–30 min and is mostly gone after a full night. A dose taken late, or with less than 7–8 h left in bed, is what leaves you impaired the next morning",
    timing: "In bed, right before sleeping, on an empty stomach (a meal delays it by about an hour) — and only with 7–8 h of sleep ahead",
    caution: "Adds to alcohol, Frontin, Atarax and mirtazapine — sedation stacks, and so does the risk of sleep-walking, eating or driving with no memory of it. Women clear it more slowly. Meant for short-term use; tolerance builds with nightly doses — prescription med, follow your doctor's dosing",
  }],
  [/zopiclon|imovane|zopitin/, {
    halfLifeH: 5,
    duration: "Half-life ≈5 h — longer than zolpidem, so next-morning grogginess is more common, especially after a late dose",
    timing: "Right before bed, with 7–8 h of sleep ahead",
    caution: "A bitter, metallic taste the next day is typical. Stacks with alcohol, benzodiazepines and Atarax; short-term use only",
  }],
  [/clonazepam|rivotril/, {
    halfLifeH: 35,
    duration: "Half-life ≈30–40 h — a daily dose accumulates for about a week before it levels off, and the next day is never drug-free",
    timing: "As prescribed; bedtime dosing moves most of the sedation into the night",
    caution: "Dependence builds with regular use; never stop abruptly — reductions belong on a prescriber-planned taper. Strongly additive with alcohol, Atarax, mirtazapine and sleeping pills",
  }],
  [/diazepam|apaurin|valium|seduxen/, {
    halfLifeH: 48,
    duration: "Half-life ≈2 days, and its active metabolite lasts longer still — regular doses build up over a week or more",
    timing: "As prescribed",
    caution: "Dependence builds with regular use; never stop abruptly. Additive with alcohol and every other sedative; impairs driving well into the next day",
  }],
  [/bromazepam|lexaurin|lexotan/, {
    halfLifeH: 20,
    duration: "Half-life ≈20 h — a bedtime dose is still mostly present in the morning",
    timing: "As prescribed; short-term",
    caution: "Dependence builds with regular use; taper with your prescriber. Additive with alcohol, Atarax and mirtazapine",
  }],
  [/lorazepam|lorafen|ativan/, {
    halfLifeH: 12,
    duration: "Half-life ≈12 h, effect ~6–8 h",
    timing: "As prescribed; short-term",
    caution: "Dependence builds with regular use; taper with your prescriber. Additive with alcohol and other sedatives",
  }],
  [/oxazepam/, {
    halfLifeH: 8,
    duration: "Half-life ≈8 h — one of the shorter benzodiazepines",
    timing: "As prescribed",
    caution: "Dependence builds with regular use; additive with alcohol and other sedatives",
  }],
  [/trazodon|trittico/, {
    halfLifeH: 7,
    duration: "Half-life ≈7 h — low doses used for sleep are largely cleared by morning",
    timing: "At bedtime, after a light snack",
    caution: "Adds to Elicea's serotonin load and to other sedatives; stand up slowly — it can drop blood pressure",
  }],
  [/quetiapin|ketilept|seroquel|kventiax/, {
    halfLifeH: 7,
    duration: "Half-life ≈7 h (the XR form is released over the day); low-dose sedation can linger into the morning",
    timing: "Evening",
    caution: "Weight and blood sugar can creep up with long-term use — your food and weight logs will show it. Additive with alcohol and other sedatives",
  }],
  [/pregabalin|lyrica/, {
    halfLifeH: 6,
    duration: "Half-life ≈6 h; usually dosed twice a day",
    timing: "Same times daily, with or without food",
    caution: "Additive with alcohol, benzodiazepines and opioids — breathing as well as sedation. Don't stop abruptly after regular use",
  }],
  [/gabapentin|neurontin/, {
    halfLifeH: 6,
    duration: "Half-life ≈5–7 h; usually dosed three times a day",
    timing: "Spread evenly through the day",
    caution: "Additive with alcohol, benzodiazepines and opioids. Don't stop abruptly after regular use",
  }],

  // ── Antidepressants with their own half-life ──
  [/sertralin|zoloft|asentra|serlift/, {
    halfLifeH: 26,
    duration: "Half-life ≈26 h — steady state after about a week; mood effects build over 4–6 weeks",
    timing: "Same time daily, with food; morning if it disturbs sleep",
    caution: "Never stop or change the dose abruptly — taper with your prescriber. Serotonin load adds up with tramadol, triptans and other antidepressants",
  }],
  [/bupropion|wellbutrin|elontril/, {
    halfLifeH: 21,
    duration: "Half-life ≈21 h (active metabolites longer) — steady state in about a week",
    timing: "Morning — an evening dose often costs sleep",
    caution: "Lowers the seizure threshold: don't exceed the dose, and heavy drinking followed by stopping suddenly is a risk. Can raise blood pressure",
  }],
  [/vortioxetin|brintellix/, {
    halfLifeH: 66,
    duration: "Half-life ≈66 h — steady state after about two weeks",
    timing: "Same time daily",
    caution: "Nausea early on is common and usually fades. Serotonin load adds up with tramadol, triptans and other antidepressants",
  }],
  [/duloxetin|cymbalta/, {
    halfLifeH: 12,
    duration: "Half-life ≈12 h, once daily",
    timing: "Same time daily, with food",
    caution: "Never stop abruptly — discontinuation symptoms are strong with this one. Serotonin load adds up with tramadol and other antidepressants",
  }],

  // ── Pain and fever ──
  [/metamizol|novalgin|algifen|analgin/, {
    halfLifeH: 3,
    duration: "Its active metabolite has a half-life ≈3 h; relief lasts ~4–6 h",
    timing: "With or without food",
    caution: "A rare but serious drop in white blood cells is possible — fever, sore throat or mouth ulcers while taking it need a doctor promptly",
  }],
  [/diclofenac|voltaren|dicloreum|olfen|veral/, {
    halfLifeH: 2,
    duration: "Half-life ≈2 h; slow-release forms spread that over 12–24 h",
    timing: "With food",
    caution: "Same stomach cautions as ibuprofen, plus a heart/blood-pressure load with regular use; don't stack two NSAIDs",
  }],
  [/ketoprofen|ketonal/, {
    halfLifeH: 2,
    duration: "Half-life ≈2 h; effect ~4–6 h",
    timing: "With food",
    caution: "An NSAID like ibuprofen — hard on the stomach; don't combine with other NSAIDs or alcohol",
  }],
  [/nimesulid|aulin|nimesil/, {
    halfLifeH: 4,
    duration: "Half-life ≈2–5 h; effect ~6–8 h",
    timing: "After a meal",
    caution: "Limited to short courses (max ~15 days) because of liver risk — avoid with alcohol and paracetamol-heavy days",
  }],
  [/tramadol|tramal|tralgit|zaldiar|doreta/, {
    halfLifeH: 6,
    duration: "Half-life ≈6 h; relief ~6 h",
    timing: "As prescribed; with or without food",
    caution: "With Elicea, sertraline or mirtazapine the serotonin load stacks — agitation, fever, tremor or confusion need urgent medical advice — and seizure risk rises. Additive with alcohol and benzodiazepines. Zaldiar and Doreta also contain paracetamol — count it",
  }],
  [/codein|kodein/, {
    halfLifeH: 3,
    duration: "Half-life ≈3 h; effect ~4–6 h",
    timing: "As prescribed",
    caution: "An opioid — additive with alcohol, benzodiazepines and sleeping pills; constipating",
  }],
  [/sumatriptan|imigran/, {
    halfLifeH: 2,
    duration: "Half-life ≈2 h — a returning migraine after ~a day is common",
    timing: "At the start of the headache phase, not the aura",
    caution: "Check with your doctor if you're on an SSRI like Elicea (serotonin); respect the daily maximum",
  }],

  // ── Allergy (specific names before the ones they contain) ──
  [/desloratadin|aerius|dasselta/, {
    halfLifeH: 27,
    duration: "Half-life ≈27 h — one dose covers the day comfortably",
    timing: "Any time — non-drowsy for most",
  }],
  [/levocetirizin|xyzal/, {
    halfLifeH: 8,
    duration: "Half-life ≈8 h; one dose covers ~24 h",
    timing: "Evening if it makes you drowsy",
  }],
  [/bilastin|bilaxten/, {
    halfLifeH: 14,
    duration: "Half-life ≈14 h; one dose covers ~24 h",
    timing: "On an empty stomach — 1 h before or 2 h after food or fruit juice, which cut its absorption",
  }],
  [/fexofenadin|telfast|allegra/, {
    halfLifeH: 14,
    duration: "Half-life ≈14 h; one dose covers ~24 h",
    timing: "With water, not fruit juice (it blocks absorption)",
  }],

  // ── Everyday prescriptions ──
  [/propranolol|inderal/, {
    halfLifeH: 4,
    duration: "Half-life ≈4 h; effect on heart rate ~6–12 h",
    timing: "As prescribed; for situational anxiety, ~1 h before",
    caution: "Lowers heart rate and blunts HRV and workout heart-rate zones — your ring numbers will show it. Don't stop abruptly after regular use; avoid with asthma",
  }],
  [/bisoprolol|concor/, {
    halfLifeH: 11,
    duration: "Half-life ≈11 h, once daily",
    timing: "Morning",
    caution: "Lowers resting heart rate — expected in your ring data. Don't stop abruptly",
  }],
  [/levothyroxin|euthyrox|letrox/, {
    duration: "Half-life ≈7 days — a missed tablet barely moves the level; a dose change takes ~6 weeks to settle",
    timing: "On an empty stomach, 30–60 min before breakfast and coffee",
    caution: "Iron, calcium, magnesium and coffee block absorption — separate them by ~4 h",
  }],
  [/metformin|glucophage|siofor/, {
    halfLifeH: 5,
    duration: "Half-life ≈5 h; extended-release forms once daily",
    timing: "With meals — cuts the stomach side effects",
    caution: "Heavy drinking with metformin is a real risk; long-term use can lower B12",
  }],
  [/loperamid|imodium/, {
    halfLifeH: 11,
    duration: "Half-life ≈11 h",
    timing: "After each loose stool, within the daily maximum",
    caution: "Not with fever or blood in the stool — see a doctor instead",
  }],
  [/famotidin|quamatel/, {
    halfLifeH: 3,
    duration: "Half-life ≈3 h; acid relief ~10–12 h",
    timing: "Before meals or at bedtime",
  }],
  [/amoxicil+in|augmentin|amoksiklav|ospamox|duomox/, {
    halfLifeH: 1,
    duration: "Half-life ≈1 h — which is why it's dosed 2–3 times a day",
    timing: "Evenly spaced; with food if it upsets the stomach",
    caution: "Finish the course as prescribed; a rash is worth telling the doctor about",
  }],
  [/azit?h?romycin|sumamed|azitrox/, {
    halfLifeH: 68,
    duration: "Half-life ≈68 h — a 3-day course keeps working for about a week",
    timing: "Same time daily",
    caution: "Finish the course; some heart-rhythm medicines don't mix with it",
  }],

  // ── More antidepressants and mood medicines ──
  // Lookbehind, so escitalopram (Elicea, further down) is not read as citalopram.
  [/(?<!es)citalopram|citalec|cipramil|seropram/, {
    halfLifeH: 35,
    duration: "Half-life ≈35 h — steady state after about a week; mood effects build over 4–6 weeks",
    timing: "Same time daily",
    caution: "Never stop or change the dose abruptly — taper with your prescriber. Serotonin load adds up with tramadol, triptans and other antidepressants",
  }],
  [/paroxetin|seroxat|paxil/, {
    halfLifeH: 21,
    duration: "Half-life ≈21 h, once daily",
    timing: "Morning, with food",
    caution: "Stopping it is harder than most SSRIs — taper slowly with your prescriber. Serotonin load adds up with tramadol and triptans",
  }],
  [/fluoxetin|prozac|deprex/, {
    halfLifeH: 96,
    duration: "Half-life ≈4 days, and its active metabolite lasts 1–2 weeks — it takes a month to reach steady state, and weeks to leave",
    timing: "Morning — it can be activating",
    caution: "Because it lingers, interactions outlast the last dose by weeks. Serotonin load adds up with tramadol and triptans",
  }],
  [/venlafaxin|efectin|olwexya/, {
    halfLifeH: 11,
    duration: "Half-life ≈5 h, ≈11 h for its active metabolite — extended-release capsules cover a day",
    timing: "Same time daily, with food",
    caution: "A missed dose is felt within a day (dizziness, 'brain zaps') — never stop abruptly. Can raise blood pressure at higher doses",
  }],
  [/lamotrigin|lamictal|lamolep/, {
    halfLifeH: 29,
    duration: "Half-life ≈29 h (shorter with some other medicines, much longer with valproate)",
    timing: "Same time daily",
    caution: "A new rash in the first two months needs a doctor promptly. The dose is built up slowly on purpose — don't skip ahead",
  }],
  [/lithium|litium|contemnol/, {
    halfLifeH: 24,
    duration: "Half-life ≈24 h; blood levels are checked for a reason",
    timing: "Same time daily",
    caution: "Dehydration, heavy sweating, ibuprofen and other NSAIDs raise lithium levels — tremor, diarrhoea or confusion need a doctor",
  }],
  [/valpro|depakin|orfiril/, {
    halfLifeH: 14,
    duration: "Half-life ≈14 h",
    timing: "With food, same times daily",
    caution: "Additive with alcohol; raises lamotrigine levels sharply",
  }],
  [/aripiprazol|abilify/, {
    halfLifeH: 75,
    duration: "Half-life ≈3 days — steady state after about two weeks",
    timing: "Same time daily; morning if it keeps you up",
    caution: "Restlessness (an urge to keep moving) is a known side effect worth mentioning to your prescriber",
  }],
  [/olanzapin|zyprexa|olpinat|zalasta/, {
    halfLifeH: 33,
    duration: "Half-life ≈33 h; sedating",
    timing: "Evening",
    caution: "Appetite and weight rise for many people — your food and weight logs will show it. Additive with alcohol and other sedatives",
  }],

  // ── ADHD ──
  [/methylfenidat|methylphenidat|ritalin|concerta|medikinet/, {
    halfLifeH: 3,
    duration: "Half-life ≈3 h — plain tablets last ~4 h; Concerta and other long-acting forms release it over ~12 h",
    timing: "Morning — a late dose costs sleep",
    caution: "Raises heart rate and blood pressure (visible in your ring data) and cuts appetite; stacks with caffeine",
  }],
  [/lisdexamfetamin|elvanse|vyvanse/, {
    halfLifeH: 11,
    duration: "Converted to dexamfetamine over hours; half-life ≈11 h, effect ~13 h",
    timing: "Early morning — it runs into the evening",
    caution: "Raises heart rate and blood pressure; cuts appetite; stacks with caffeine and costs sleep if taken late",
  }],
  [/atomoxetin|strattera/, {
    halfLifeH: 5,
    duration: "Half-life ≈5 h, but the effect builds over weeks of daily use",
    timing: "Morning, or split morning and evening",
    caution: "Mood changes early on are worth telling your prescriber about; paroxetine and fluoxetine raise its levels",
  }],

  // ── Heart, cholesterol, blood thinners ──
  [/amlodipin|norvasc|amlator/, {
    halfLifeH: 40,
    duration: "Half-life ≈30–50 h — a missed day barely moves the level",
    timing: "Same time daily",
    caution: "Ankle swelling is a common side effect; grapefruit raises its level a little",
  }],
  [/telmisartan|micardis|tolura/, {
    halfLifeH: 24,
    duration: "Half-life ≈24 h, once daily",
    timing: "Same time daily",
    caution: "Ibuprofen and other NSAIDs blunt it and strain the kidneys together with it",
  }],
  [/atorvastatin|atoris|sortis|lipitor/, {
    halfLifeH: 14,
    duration: "Half-life ≈14 h; the cholesterol effect is long-term",
    timing: "Any consistent time",
    caution: "Unexplained muscle pain is worth a call to your doctor; large amounts of grapefruit raise its level",
  }],
  [/rosuvastatin|crestor|roswera|rosucard/, {
    halfLifeH: 19,
    duration: "Half-life ≈19 h; the cholesterol effect is long-term",
    timing: "Any consistent time",
    caution: "Unexplained muscle pain is worth a call to your doctor",
  }],
  [/apixaban|eliquis/, {
    halfLifeH: 12,
    duration: "Half-life ≈12 h — protection fades within a day of a missed dose",
    timing: "Twice daily, 12 h apart",
    caution: "Ibuprofen, naproxen, aspirin and other NSAIDs raise bleeding risk — paracetamol is the usual painkiller. Never skip doses on your own",
  }],
  [/rivaroxaban|xarelto/, {
    halfLifeH: 9,
    duration: "Half-life ≈5–13 h — protection fades within a day of a missed dose",
    timing: "With food (the higher doses need it to absorb)",
    caution: "Ibuprofen, naproxen, aspirin and other NSAIDs raise bleeding risk — paracetamol is the usual painkiller. Never skip doses on your own",
  }],
  [/warfarin|lawarin|coumadin/, {
    halfLifeH: 40,
    duration: "Half-life ≈40 h; the INR responds over days",
    timing: "Same time daily",
    caution: "Alcohol, NSAIDs, many antibiotics and big swings in leafy greens (vitamin K) all move the INR — keep them steady and tell your clinic about changes",
  }],

  // ── Colds, stomach, pain relief extras ──
  [/dextromethorphan|dextrometorfan|robitussin|stopex/, {
    halfLifeH: 3,
    duration: "Half-life ≈3 h in most people (much longer in some)",
    timing: "As on the pack, not near bedtime if it keeps you up",
    caution: "With Elicea, sertraline or other antidepressants the serotonin load stacks — check with a pharmacist first",
  }],
  [/acetylcystein|\bacc\b|fluimucil/, {
    halfLifeH: 6,
    duration: "Half-life ≈6 h",
    timing: "Earlier in the day — the loosened mucus needs coughing up",
  }],
  [/ambroxol|mucosolvan|flavamed|ambrobene/, {
    halfLifeH: 10,
    duration: "Half-life ≈10 h",
    timing: "With food, not late in the evening",
  }],
  [/metoclopramid|metoklopramid|degan|cerucal/, {
    halfLifeH: 5,
    duration: "Half-life ≈5 h",
    timing: "30 min before a meal",
    caution: "Short courses only (max ~5 days); restlessness or muscle spasms mean stop and call a doctor",
  }],
  [/ondansetron|zofran/, {
    halfLifeH: 4,
    duration: "Half-life ≈4 h",
    timing: "As needed for nausea",
    caution: "Constipating; check with a pharmacist if you're on an SSRI",
  }],
  [/tolperison|mydocalm/, {
    halfLifeH: 2.5,
    duration: "Half-life ≈2.5 h",
    timing: "After meals",
  }],
  [/methylprednisolon|metylprednizolon|medrol/, {
    halfLifeH: 2.5,
    duration: "Plasma half-life ≈2.5 h, but the anti-inflammatory effect lasts 12–36 h",
    timing: "Morning — an evening dose often costs sleep",
    caution: "Raises blood sugar and can lift mood or cause insomnia; longer courses are tapered, not stopped",
  }],
  [/prednison|prednisolon|prednizon/, {
    halfLifeH: 3,
    duration: "Plasma half-life ≈3 h, but the effect lasts 12–36 h",
    timing: "Morning, with food",
    caution: "Raises blood sugar and can lift mood or cause insomnia; longer courses are tapered, not stopped",
  }],
  [/dimetinden|fenistil/, {
    halfLifeH: 6,
    duration: "Half-life ≈6 h (drops and tablets; the gel stays in the skin)",
    timing: "Evening if it makes you drowsy",
    caution: "Sedating antihistamine — adds to alcohol and sleeping pills",
  }],
  [/nikotin|nicotin|nicorette|\bzyn\b|\bvelo\b|snus|\bvape\b/, {
    halfLifeH: 2,
    duration: "Half-life ≈2 h; the cravings cycle is roughly that long",
    timing: "Not in the last hours before bed",
    caution: "Raises heart rate and blood pressure and fragments sleep — visible in your ring's night heart rate",
  }],
  [/sildenafil|viagra/, {
    halfLifeH: 4,
    duration: "Half-life ≈4 h; effective window ~4–5 h",
    timing: "About an hour before; a fatty meal delays it",
    caution: "Never with nitrates (chest-pain medicines) or poppers; alcohol blunts it",
  }],
  [/tadalafil|cialis/, {
    halfLifeH: 17.5,
    duration: "Half-life ≈17.5 h — the effective window is up to ~36 h",
    timing: "Any time; food doesn't matter",
    caution: "Never with nitrates (chest-pain medicines) or poppers",
  }],
  [/finasterid|proscar|propecia/, {
    halfLifeH: 6,
    duration: "Half-life ≈6 h, but the hormone effect is long-term",
    timing: "Same time daily",
  }],
  [/oxycodon|oxykodon|oxycontin|targin/, {
    halfLifeH: 4,
    duration: "Half-life ≈4 h (slow-release forms last ~12 h)",
    timing: "As prescribed",
    caution: "An opioid — strongly additive with alcohol, benzodiazepines and sleeping pills (breathing, not just sedation); constipating",
  }],

  // ── Antibiotics ──
  [/doxycyklin|doxycyclin|doxybene|deoxymykoin/, {
    halfLifeH: 18,
    duration: "Half-life ≈18 h, once or twice daily",
    timing: "Upright with a full glass of water, not right before lying down",
    caution: "Dairy, iron, calcium and magnesium block it — separate by 2–3 h. Makes skin burn faster in the sun",
  }],
  [/ciprofloxacin|ciphin|ciprinol/, {
    halfLifeH: 4,
    duration: "Half-life ≈4 h, twice daily",
    timing: "Evenly spaced",
    caution: "Dairy, iron, calcium and magnesium block it — separate by 2–6 h. Tendon pain means stop and call a doctor",
  }],
  [/klaritromycin|clarithromycin|klacid|fromilid/, {
    halfLifeH: 5,
    duration: "Half-life ≈5 h, twice daily",
    timing: "Evenly spaced",
    caution: "Interacts with many medicines, including some statins — check with a pharmacist",
  }],
  [/cefuroxim|zinnat|xorimax/, {
    halfLifeH: 1.5,
    duration: "Half-life ≈1.5 h, twice daily",
    timing: "With food — it absorbs better",
    caution: "Finish the course as prescribed",
  }],

  [/hydroxyzin|atarax/, {
    halfLifeH: 20,
    duration: "You feel it for ~4–6 h, but the half-life is ≈20 h — after a bedtime dose roughly 70% is still on board at 8:00, which is why the next morning can feel foggy",
    timing: "1–2 h before bed when used for evening anxiety or sleep; a daytime dose will sedate",
    caution: "Adds to alcohol, benzodiazepines (Frontin/Xanax), mirtazapine and sleeping pills — the sedation stacks; anticholinergic (dry mouth, blurry vision). Clears more slowly with age and in liver problems — prescription med, follow your doctor's dosing",
  }],
  [/diphenhydramin|benadryl|sominex/, {
    halfLifeH: 8,
    duration: "Half-life ≈8 h — a midnight dose is still ~50% present at 8:00",
    timing: "Right before bed if used for sleep",
    caution: "Tolerance to the sedative effect builds within days; strongly anticholinergic — not a good long-term sleep aid",
  }],
  [/ibuprofen|brufen|nurofen|ibalgin/, {
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
  [/naproxen|nalgesin|aleve/, {
    halfLifeH: 14,
    duration: "Half-life ≈14 h — one dose covers ~12 h, much longer than ibuprofen",
    timing: "With food",
    caution: "Same stomach cautions as ibuprofen; don't stack two NSAIDs",
  }],
  [/omeprazol|pantoprazol|esomeprazol|helicid|controloc|nolpaza/, {
    duration: "Plasma half-life is only ~1 h, but it disables acid pumps for 24–72 h — the effect long outlives the drug",
    timing: "30–60 min BEFORE the first meal of the day (it needs active pumps to work)",
    caution: "Long-term use can lower B12, magnesium and calcium absorption — worth checking if you take it for months",
  }],
  [/montelukast|singulair/, {
    halfLifeH: 5,
    duration: "Half-life ≈5 h, dosed once daily",
    timing: "Evening — that's when it's been studied",
    caution: "Report any mood or sleep changes to your doctor; it's a known if uncommon side effect",
  }],
  [/escitalopram|elicea|cipralex|lexapro|esram/, {
    halfLifeH: 30,
    duration: "Half-life ≈30 h, so it barely dips between daily doses — blood levels plateau after ~1 week and the mood effect builds over 4–6 weeks",
    timing: "Same time every day; morning if it disturbs your sleep, evening if it makes you drowsy",
    caution: "Never stop or change the dose abruptly — taper with your prescriber. Often combined with mirtazapine on purpose, but the serotonin load adds up: sudden agitation, fever, tremor or confusion needs urgent medical advice",
  }],
  [/mirtazapin|mirzaten|mirzatem|remeron|esprital|calixta/, {
    halfLifeH: 26,
    duration: "Half-life ≈26 h (longer in women and with age) — the sedation is front-loaded in the first hours, but the drug is still largely present the next day and reaches steady state after ~5 days",
    timing: "At bedtime — the sedating antihistamine effect peaks early. Counter-intuitively, low doses (7.5–15 mg) are often MORE sedating than higher ones, where the activating effect starts to balance it",
    caution: "Increased appetite and weight gain are common — worth watching in your food log. Adds heavily to alcohol, Atarax and benzodiazepine sedation. Never stop abruptly; taper with your prescriber",
  }],
  [/alprazolam|frontin|xanax|neurol|helex/, {
    halfLifeH: 12,
    duration: "The calm lasts ~4–6 h but the half-life is ≈12 h — the effect fades long before the drug does, which is why regular dosing accumulates",
    timing: "As prescribed, and short-term: benzodiazepines are built for occasional use, not maintenance",
    caution: "Tolerance and physical dependence develop within weeks of daily use, and stopping abruptly after regular use can be dangerous — any reduction belongs on a prescriber-planned taper. Strongly additive with alcohol, Atarax and mirtazapine (sedation and breathing). Impairs driving; also suppresses deep and REM sleep, so a 'good' night on it can still score poorly on your ring",
  }],
  [/sertralin|zoloft|citalopram|fluoxetin|prozac|paroxetin|venlafaxin|ssri/, {
    duration: "Long half-life (roughly a day, fluoxetine much longer) — steady state after 1–2 weeks, and effects build over 4–6 weeks",
    timing: "Same time daily; morning if it energizes you, evening if it makes you sleepy",
    caution: "Never start, stop or change the dose without your doctor — stopping abruptly causes discontinuation symptoms",
  }],
  [/caffeine|kofein/, {
    halfLifeH: 5,
    duration: "Half-life ≈ 5 h — a late-afternoon dose is still half-active at midnight",
    timing: "Before 14:00 protects sleep for most people",
    caution: "Same math as the caffeine tracker uses",
  }],
]

/**
 * Look up pharmacology info for a supplement/med label. Null when unknown.
 * Named medications are checked first: they're exact brand/generic matches,
 * while the supplement normalizer includes loose element heuristics that a
 * prescription label should never fall into.
 */
export function supplementInfoFor(label: string): SupplementInfo | null {
  const folded = fold(label)
  for (const [re, info] of MED_PATTERNS) {
    if (re.test(folded)) return info
  }
  const canonical = normalizeSupplement(label)
  if (canonical && BY_CANONICAL[canonical]) return BY_CANONICAL[canonical]
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
