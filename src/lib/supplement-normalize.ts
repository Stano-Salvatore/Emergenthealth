// Canonical names for supplements/medications logged as Oura tags. The same
// substance arrives under many labels — "Vitamin D", "D3", "vit d 2000IU",
// "vitamín D", "horčík" vs "Magnesium" — and each label used to render as its
// own separate tag type. Matching is diacritics-insensitive (Slovak names
// fold to plain ASCII) and ignores dosage suffixes.

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

// First match wins — combos before their parts (D3+K2 before D3).
const CANON: [RegExp, string][] = [
  [/d3\s*[+&]\s*k2|k2\s*[+&]\s*d3/,                        "Vitamin D3 + K2"],
  [/(vitamin|vit\.?)\s*d\s*3?\b|cholecalciferol|\bd3\b|\bdecko\b/, "Vitamin D"],
  [/(vitamin|vit\.?)\s*c\b|ascorb|cecko/,                  "Vitamin C"],
  [/b\s*[-]?\s*12\b|cobalamin|kobalamin/,                  "Vitamin B12"],
  [/b\s*[-]?\s*(complex|komplex)/,                         "B-Complex"],
  [/(vitamin|vit\.?)\s*a\b|retinol/,                       "Vitamin A"],
  [/(vitamin|vit\.?)\s*e\b|tocopherol|tokoferol/,          "Vitamin E"],
  [/\bk2\b|menaquinon/,                                    "Vitamin K2"],
  [/magnesium|magnezium|horcik|\bmg\b(?!\s*\d)/,           "Magnesium"],
  [/zinc|zinok/,                                           "Zinc"],
  [/omega|fish\s*oil|rybi\s*olej/,                         "Omega-3"],
  [/\biron\b|zelezo|ferrum/,                               "Iron"],
  [/calcium|vapnik/,                                       "Calcium"],
  [/potassium|draslik/,                                    "Potassium"],
  [/selenium|selen\b/,                                     "Selenium"],
  [/melatonin/,                                            "Melatonin"],
  [/creatin|kreatin/,                                      "Creatine"],
  [/probiotic|probiotik/,                                  "Probiotics"],
  [/collagen|kolagen/,                                     "Collagen"],
  [/ashwagandha/,                                          "Ashwagandha"],
  [/curcumin|turmeric|kurkuma/,                            "Turmeric"],
  [/coq\s*10|\bq10\b|ubiquinol/,                           "CoQ10"],
  [/glutamin/,                                             "Glutamine"],
  [/folate|folic|listova/,                                 "Folate"],
  [/biotin/,                                               "Biotin"],
  [/multivitamin|multivit\b|centrum/,                      "Multivitamin"],
]

// Dosage text is noise for matching — and worse than noise for magnesium,
// whose "Mg" element rule otherwise fires on the unit in "Mirzaten 15 mg".
const DOSE_TEXT = /\b\d+([.,]\d+)?\s*(mg|mcg|µg|ug|iu|g|ml|tbl|caps?|tablet\w*|kvapk\w*|drops?)\b\.?/g

/** Canonical substance name for a raw tag label, or null when unrecognized. */
export function normalizeSupplement(rawLabel: string): string | null {
  const label = fold(rawLabel).replace(DOSE_TEXT, " ")
  for (const [re, name] of CANON) {
    if (re.test(label)) return name
  }
  return null
}

// How much of a tablet was taken, written in words rather than milligrams:
// "Atarax - half", "Frontin 1/2", "Elicea ½", Slovak "pol"/"polovica". These
// say something about the dose and nothing about which substance it was, so
// they belong out of the name for the same reason "25 mg" does — otherwise
// "Atarax" and "Atarax - half" are two different substances to every grouping
// and correlation in the app, and each half of the history can sit below the
// 5-day threshold that would have produced an insight.
//
// Anchored to the end of the label (optionally in brackets), because that is
// where a dose annotation actually goes. Matching anywhere would eat the word
// out of a genuine name — "Half-life booster" is not a half dose of anything.
const TRAILING_DOSE =
  /[\s([{,;:–—-]*(?:half|halve|quarter|third|double|triple|pol|polka|polovica|polovicu|[sš]tvrtina|[sš]tvr[tť]|tretina|dvojit[aáu]|\d\s*\/\s*\d|[½¼¾⅓⅔]|x\s*\d+|\d+\s*x)[)\]}\s.]*$/iu

/** Fallback tidy-up for unrecognized labels: strip dosage, collapse spaces. */
export function cleanLabel(rawLabel: string): string {
  let cleaned = rawLabel
    .replace(/\b\d+([.,]\d+)?\s*(mg|mcg|µg|ug|iu|g|ml|tbl|caps?|tablet\w*|kvapk\w*|drops?)\b\.?/gi, "")
    .trim()
  // Loop: "Atarax 1/2 (half)" carries two of them.
  for (let i = 0; i < 3; i++) {
    const next = cleaned.replace(TRAILING_DOSE, "").trim()
    if (next === cleaned || !next) break
    cleaned = next
  }
  cleaned = cleaned
    .replace(/[\s]*[-–—,:;/]+[\s]*$/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
  return cleaned || rawLabel.trim()
}

export { fold }
