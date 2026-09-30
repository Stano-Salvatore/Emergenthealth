// Named drinks: what a label means, once, for every reader of a drink.
//
// The Oura classifier, the caffeine estimate, the calorie count, the alcohol
// curve and Emergy's log_drink each had their own idea of what "Kofola" or
// "Nealko pivo" was, and most had none: a Kofola tag never reached the
// intake log, alcohol-free beer was a 5% beer, a latte cost nothing. This
// table answers for all of them. Figures are typical per-100ml label values —
// a stated strength or volume in the label always wins over them.

export interface DrinkProfile {
  /** The IntakeLog type this drink is stored as. */
  type: string
  /** A typical serving, for a label that carries no volume. */
  ml: number
  /** kcal per 100ml, when the drink's type alone would price it wrongly. */
  kcalPer100ml?: number
  /** Caffeine per ml. 0 means known caffeine-free. */
  caffeineMgPerMl?: number
  /** The caffeine log's compound name. */
  compound?: string
  /** Typical ABV as a fraction, for drinks whose type average would mislead. */
  abv?: number
  /** Stored under a soft type even when called a beer. */
  nonAlcoholic?: boolean
}

// Folded, lower-case labels. Order matters: the first match wins, so a
// specific drink sits above any drink its name contains.
const DRINKS: [RegExp, DrinkProfile][] = [
  // ── Alcohol-free beer, before anything that reads "pivo" or "beer" ──
  [/nealko|alkohol.?free|alcohol.?free|non.?alcoholic|\b0[.,]0\b|birell/, { type: "soda", ml: 500, kcalPer100ml: 22, abv: 0, nonAlcoholic: true }],

  // ── Coffee variants the plain coffee rules price wrongly ──
  [/decaf|bezkofein|bez kofeinu/, { type: "coffee", ml: 250, caffeineMgPerMl: 0.01, compound: "coffee" }],
  [/mocha|mokka/, { type: "coffee", ml: 300, kcalPer100ml: 70 }],
  [/frapp/, { type: "coffee", ml: 300, kcalPer100ml: 65 }],
  [/latte/, { type: "coffee", ml: 300, kcalPer100ml: 45 }],
  [/cappuccino|kapucin/, { type: "coffee", ml: 180, kcalPer100ml: 40 }],
  [/flat.?white/, { type: "coffee", ml: 160, kcalPer100ml: 40 }],

  // ── Tea: the kind decides the caffeine ──
  [/ice.?tea|ladov\w* caj|nestea|lipton ice/, { type: "tea", ml: 500, kcalPer100ml: 28, caffeineMgPerMl: 0.05, compound: "tea" }],
  [/green tea|zeleny caj|sencha|genmaicha/, { type: "tea", ml: 250, caffeineMgPerMl: 0.12, compound: "green_tea" }],
  [/herbal|bylinkov|chamomile|harmanc|rumanc|peppermint|mint tea|\bmat(a\b|ov)|rooibos|fruit tea|ovocn\w* caj|lipov|linden|ginger tea|zazvor|hibisk|hibisc/, { type: "tea", ml: 250, caffeineMgPerMl: 0 }],
  [/kombuch/, { type: "soda", ml: 330, kcalPer100ml: 15, caffeineMgPerMl: 0.06, compound: "tea" }],

  // ── Mate ──
  [/club.?mate/, { type: "mate", ml: 500, kcalPer100ml: 20, caffeineMgPerMl: 0.2, compound: "mate" }],
  [/yerba|\bmate\b|guayusa/, { type: "mate", ml: 500, caffeineMgPerMl: 0.15, compound: "mate" }],

  // ── Energy drinks (a can is 250ml unless the brand sells 500) ──
  [/monster|rockstar|big shock/, { type: "soda", ml: 500, kcalPer100ml: 45, caffeineMgPerMl: 0.32, compound: "energy_drink" }],
  [/red.?bull|\bburn\b|semtex|hell energy|energy drink|energetick/, { type: "soda", ml: 250, kcalPer100ml: 45, caffeineMgPerMl: 0.32, compound: "energy_drink" }],

  // ── Sodas ──
  [/kofola/, { type: "soda", ml: 500, kcalPer100ml: 30, caffeineMgPerMl: 0.15, compound: "cola" }],
  [/\bcola\b|coca.?cola|\bcoke\b|pepsi/, { type: "soda", ml: 330, kcalPer100ml: 42, caffeineMgPerMl: 0.1, compound: "cola" }],
  [/soda water|sodovk|club soda/, { type: "sparkling", ml: 330 }],
  [/tonic/, { type: "soda", ml: 250, kcalPer100ml: 35 }],
  [/sprite|fanta|7.?up|mirinda|lemonad|limonad|vinea|\bsoda\b/, { type: "soda", ml: 330, kcalPer100ml: 40 }],
  [/isoton|iontak|powerade|gatorade/, { type: "soda", ml: 500, kcalPer100ml: 24 }],
  // Syrup IN WATER — "Stoptussin sirup" and "cough syrup" are medicines.
  [/(sirup|syrup)\b.*\b(vod|water)|(vod|water)\w*\b.*\b(sirup|syrup)|malinovk/, { type: "water", ml: 500, kcalPer100ml: 25 }],

  // ── Juice ──
  [/coconut water|kokosov\w* voda/, { type: "juice", ml: 330, kcalPer100ml: 19 }],
  [/smoothie/, { type: "juice", ml: 300, kcalPer100ml: 55 }],
  [/juice|\bdzus|nectar|nektar/, { type: "juice", ml: 250, kcalPer100ml: 45 }],

  // ── Milk and milk drinks ──
  [/hot chocolate|horuca cokolada|\bkakao\b|cocoa/, { type: "milk", ml: 250, kcalPer100ml: 75, caffeineMgPerMl: 0.03, compound: "cocoa" }],
  [/kefir|acidko|zakysank|ayran|buttermilk|\bcmar\b|lassi/, { type: "milk", ml: 250, kcalPer100ml: 55 }],
  [/oat milk|ovsen\w* mliek|almond milk|mandlov\w* mliek|soy milk|sojov\w* mliek|rice milk|ryzov\w* mliek/, { type: "milk", ml: 250, kcalPer100ml: 40 }],
  [/\bmilk\b(?! thistle)|\bmlieko\b|\bmleko\b/, { type: "milk", ml: 250, kcalPer100ml: 60 }],

  // ── Alcohol with a strength its type average gets wrong ──
  [/radler|shandy/, { type: "beer", ml: 500, abv: 0.025 }],
  [/hard seltzer/, { type: "alcohol", ml: 330, abv: 0.045 }],
  [/prosecco|\bsekt\b|champagne|sampansk|\bcava\b|cremant/, { type: "wine", ml: 150, abv: 0.11 }],
  [/medovin|\bmead\b/, { type: "wine", ml: 150, abv: 0.12 }],
  [/aperol|spritz|mojito|cuba libre|margarita|pina colada|daiquiri|caipirinh|long island|sex on the beach/, { type: "alcohol", ml: 250 }],
  [/baileys|amaretto|limoncello|liker|liqueur/, { type: "spirits", ml: 40, abv: 0.2 }],
  [/tatratea/, { type: "spirits", ml: 40, abv: 0.52 }],
  [/becherovk|jagermeister|jager|fernet|hruskovic|palenk|marhulovic|brandy|cognac|konak|absinth|ouzo|grappa|sambuca|metax/, { type: "spirits", ml: 40 }],
]

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

/** "Coke Zero", "Red Bull sugarfree": the sweet drink without the sugar. */
const SUGAR_FREE = /\bzero\b|\blight\b|\bdiet\b|sugar.?free|bez cukru|\b0 ?kcal\b/

/** The catalog's reading of a drink label, or null when it names nothing known. */
export function drinkProfile(label: string | null | undefined): DrinkProfile | null {
  if (!label) return null
  const l = fold(label)
  for (const [re, profile] of DRINKS) {
    if (!re.test(l)) continue
    if (profile.kcalPer100ml && profile.type === "soda" && SUGAR_FREE.test(l)) {
      return { ...profile, kcalPer100ml: 0 }
    }
    return profile
  }
  return null
}

const ALCOHOLIC_TYPES = new Set(["beer", "wine", "spirits", "alcohol"])

/**
 * The type a drink is stored as, from what Emergy called it and what it is.
 * The model's type stands, except where the name says otherwise: an
 * alcohol-free beer is not beer, and "other" is a gap the catalog can fill.
 */
export function resolveDrinkType(modelType: string, label: string): string {
  const p = drinkProfile(label)
  if (!p) return modelType
  if (p.nonAlcoholic && ALCOHOLIC_TYPES.has(modelType)) return p.type
  if (modelType === "other") return p.type
  return modelType
}
