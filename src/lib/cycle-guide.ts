// What each phase of the cycle tends to bring, and what tends to help.
//
// Written as information, never instruction: what many people notice, what
// studies have found, and where a pharmacist or doctor is the right person to
// ask. No doses — those belong to the label, the leaflet and the person who
// prescribed it. Bodies vary a lot; the page pairs this with the user's own data so
// "many people notice" can become "you notice".

import type { Contraception, Phase } from "@/lib/cycle"

export interface PhaseGuide {
  name: string
  emoji: string
  /** Where it sits in a 28-day cycle; the page replaces it with the user's own days. */
  typicalDays: string
  hormones: string
  summary: string
  expect: string[]
  food: string[]
  movement: string[]
  sleep: string[]
  medicines: string[]
}

export const PHASE_GUIDE: Record<Phase, PhaseGuide> = {
  menstrual: {
    name: "Period",
    emoji: "🩸",
    typicalDays: "Days 1–5",
    hormones: "Oestrogen and progesterone are at their lowest, and the lining of the womb is shed.",
    summary: "The first day of real bleeding is day 1 of the cycle.",
    expect: [
      "Cramps and a dull lower-back ache, usually worst in the first one to three days.",
      "Lower energy at the start, often lifting as the period goes on.",
      "Mood often brightens after the first days as oestrogen starts to climb again.",
      "Looser stools or an upset stomach — the same chemicals that cause cramps act on the gut.",
      "Headaches for some, linked to the drop in oestrogen.",
    ],
    food: [
      "Iron-rich foods help replace what is lost: red meat, fish, eggs, lentils, beans, tofu, dark leafy greens, fortified cereals.",
      "Plant iron is absorbed better with vitamin C in the same meal — peppers, citrus, kiwi, tomatoes. Tea and coffee with a meal absorb less, so between meals is better for them.",
      "Oily fish, walnuts and flax are rich in omega-3, which studies link with milder cramps.",
      "Ginger, fresh or as tea, has some evidence for easing cramps.",
      "Water helps with bloating; alcohol tends to make cramps and sleep worse.",
    ],
    movement: [
      "Rest when the body asks for it — there is nothing to push through.",
      "Gentle movement such as walking, yoga, stretching or easy cycling eases cramps for many.",
      "Heat on the belly or lower back — a hot-water bottle or a heat patch — helped about as much as some painkillers in studies.",
    ],
    sleep: [
      "Cramps can wake you; heat before bed and lying on your side with knees drawn up help many.",
      "Overnight pads or period underwear can take the worry out of the night.",
    ],
    medicines: [
      "Anti-inflammatory painkillers such as ibuprofen or naproxen block the chemicals behind cramps and can make flow a little lighter. They tend to work best taken at the first sign of pain, with food, as the label says.",
      "They are not right for everyone — for example with stomach ulcers, kidney problems, some kinds of asthma, or in pregnancy. A pharmacist can say whether they suit you.",
      "Paracetamol eases some pain but usually helps less with cramps; it is an option when anti-inflammatories are not.",
      "Iron tablets are for a low level a blood test has shown — heavy periods are one of the most common causes of low iron.",
      "Painkillers logged under Meds show in \"In my body\" with how much is still active.",
    ],
  },

  follicular: {
    name: "Follicular",
    emoji: "🌱",
    typicalDays: "Days 6–13",
    hormones: "Oestrogen rises as an egg matures, building the womb lining back up.",
    summary: "From the end of the period up to ovulation — the part of the cycle that varies most in length.",
    expect: [
      "Energy, mood and motivation often rise through this phase.",
      "Many feel more social, focused and up for new things.",
      "Skin is often at its clearest.",
      "Appetite is often steady or lower than later in the cycle.",
    ],
    food: [
      "A good time to build meals around protein, fibre and plenty of vegetables.",
      "Appetite can be low while energy is high, so it is easy to under-eat on active days — carbohydrates around training help.",
      "Fermented foods and fibre (yogurt, kefir, sauerkraut, whole grains, beans) support the gut — nothing phase-specific, just an easy time to build habits.",
    ],
    movement: [
      "Many feel strongest and recover fastest now — a natural window for harder training, strength work or something new.",
      "The research on timing training to the cycle is mixed, so how you feel is the better guide.",
    ],
    sleep: [
      "Sleep is often at its best in this phase.",
    ],
    medicines: [
      "Nothing phase-specific. If the last period was rough, this is a calm moment to ask a pharmacist or doctor what might help next time.",
    ],
  },

  ovulation: {
    name: "Ovulation",
    emoji: "🌕",
    typicalDays: "Around day 14",
    hormones: "A surge of LH releases an egg; oestrogen peaks just before it and there is a small rise in testosterone.",
    summary: "The egg lives for about a day; sperm can survive up to five, which is why the fertile window starts days earlier.",
    expect: [
      "Energy, confidence and libido peak for many.",
      "Discharge becomes clear, slippery and stretchy, like raw egg white.",
      "A one-sided twinge low in the belly for a few hours (\"mittelschmerz\") for some.",
      "Light spotting for a few people.",
      "Body temperature rises by about 0.3 °C after ovulation and stays up until the period — the ring's temperature can show it.",
    ],
    food: [
      "No special diet is needed — a balanced plate of vegetables, fruit, whole grains and protein.",
      "Water matters a little more as body temperature rises afterwards.",
    ],
    movement: [
      "Energy often peaks — a good time for the hardest sessions if you feel like it.",
      "Some studies suggest joints are slightly looser around ovulation, so a proper warm-up is worth it.",
    ],
    sleep: [
      "Usually unaffected; some notice a short dip as the temperature shifts.",
    ],
    medicines: [
      "The anti-inflammatory painkillers that help period cramps also help ovulation pain, used as the label says.",
      "Ovulation pain that is severe or lasts more than a day or two is worth a doctor's look.",
      "An ovulation (LH) test turns positive about a day before ovulation — log it here and the estimate tightens.",
    ],
  },

  luteal: {
    name: "Luteal",
    emoji: "🌙",
    typicalDays: "Days 15–28",
    hormones: "Progesterone rises and the body runs warmer; if no pregnancy starts, both hormones fall in the last days and the period follows.",
    summary: "The steadier half of the cycle — about two weeks for most people.",
    expect: [
      "A warmer body, a resting heart rate a few beats higher and a lower HRV — the ring sees this every cycle, and it is expected, not a warning.",
      "Appetite rises: the body uses slightly more energy now, and the hunger is real.",
      "Energy steady early on, often dipping towards the end.",
      "Lighter, more broken sleep for many, especially in the last days.",
    ],
    food: [
      "Studies estimate energy use rises by roughly 100–300 kcal a day — a little more food is reasonable.",
      "Meals with protein, fibre and slow carbohydrates (oats, whole-grain bread, potatoes, beans) take the edge off cravings and energy dips.",
      "Magnesium-rich foods: nuts, seeds, beans, leafy greens, whole grains, dark chocolate.",
      "Calcium and vitamin D — dairy or fortified alternatives, sardines, tofu. In trials, getting enough calcium was linked with milder PMS.",
      "In the last days, less salt helps with bloating, and less caffeine helps many with breast tenderness, anxiety and sleep.",
      "Alcohol tends to worsen sleep and mood, and the premenstrual days are when many feel that most.",
    ],
    movement: [
      "Long or hot sessions can feel harder with a higher body temperature — more water, and an easier pace in the heat.",
      "In the last days, lower intensity, walking and mobility work are all fine if energy drops.",
    ],
    sleep: [
      "The higher body temperature makes sleep lighter for many — a cooler bedroom, around 18 °C, and breathable bedding help.",
      "No alcohol in the evening and a steady bedtime matter more now than at any other point of the cycle.",
      "More wake-ups and a lower HRV on the ring in this phase are expected.",
    ],
    medicines: [
      "Calcium, magnesium and vitamin B6 have some trial evidence for PMS; the effects are modest. A pharmacist can check them against anything else you take.",
      "Premenstrual low mood or anxiety that seriously disrupts work or relationships can be PMDD. It is treatable, and a doctor is the person to see.",
      "Painkillers for premenstrual headaches or breast pain follow the same label rules as for cramps.",
    ],
  },
}

/** The last five or so days before the period: a part of the luteal phase with its own character. */
export const PREMENSTRUAL = {
  name: "Premenstrual days",
  expect: [
    "Bloating, breast tenderness and cravings.",
    "Irritability, low mood or anxiety for some.",
    "Spots or breakouts.",
    "Headaches and poorer sleep.",
  ],
  helps: [
    "Regular meals with protein and slow carbohydrates.",
    "Less salt, caffeine and alcohol.",
    "Daylight and movement, even a short walk.",
    "An earlier, cooler, more regular bedtime.",
    "Fewer hard commitments, if the calendar allows.",
  ],
}

export interface ContraceptionGuide {
  name: string
  summary: string
  notes: string[]
}

const INTERACTIONS = "Some medicines make hormonal contraception less effective — rifampicin-type antibiotics, some epilepsy medicines and St John's wort among them. Most common antibiotics do not, but a pharmacist can check anything new."

export const CONTRACEPTION_GUIDE: Record<Contraception, ContraceptionGuide> = {
  none: {
    name: "No hormonal contraception",
    summary: "Your natural cycle — the phases on this page apply. Predictions and the fertile window are estimates, not contraception.",
    notes: [
      "A period can come late after stress, illness, travel, a change in weight or intense training — and in pregnancy. If pregnancy is possible, a home test from the day the period was due is the usual first step.",
    ],
  },
  combined_pill: {
    name: "Combined pill",
    summary: "It stops ovulation, so the natural phases do not happen. The bleed in the break week is a withdrawal bleed from the pause in hormones, not a period.",
    notes: [
      "Most people bleed two to four days into the break; some barely bleed at all — both are common.",
      "A missed or late pill: what to do depends on the pill and where you are in the pack — the leaflet says.",
      "Vomiting or severe diarrhoea within a few hours of a pill can mean it was not absorbed; the leaflet covers that too.",
      INTERACTIONS,
      "Spotting in the first few months is common; if it carries on, mention it to your doctor.",
      "Running packs back to back to skip the bleed is something many do with their doctor's agreement.",
    ],
  },
  progestin_pill: {
    name: "Progestogen-only pill",
    summary: "Taken every day with no break. Some types stop ovulation, others mainly thicken cervical mucus, so phases may or may not happen.",
    notes: [
      "Bleeding is often irregular, lighter, or stops altogether.",
      "Timing matters more than with the combined pill — depending on the type the window is 3 or 12 hours. The leaflet says which yours is.",
      "Vomiting within a few hours of a pill can mean it was not absorbed; the leaflet says what to do.",
      INTERACTIONS,
    ],
  },
  hormonal_iud: {
    name: "Hormonal IUD (coil)",
    summary: "Releases a progestogen inside the womb. Periods often get lighter, irregular or stop — yet many people still ovulate, so the phases can carry on underneath.",
    notes: [
      "Irregular spotting in the first three to six months is common and usually settles.",
      "Cramps usually ease over time.",
      "The ring's temperature can still show ovulation even without a period.",
    ],
  },
  copper_iud: {
    name: "Copper IUD (coil)",
    summary: "No hormones — your natural cycle carries on, and the phases on this page apply.",
    notes: [
      "Periods are often heavier, longer and crampier, especially in the first months.",
      "Anti-inflammatory painkillers can reduce both the pain and the bleeding — a pharmacist can say whether they suit you.",
      "With heavier periods, iron is worth keeping an eye on; a blood test shows it.",
    ],
  },
  implant: {
    name: "Implant",
    summary: "It stops ovulation. Bleeding is unpredictable: it may stop, or come rarely, often, or for longer.",
    notes: [
      "If the bleeding pattern is a problem, a doctor has options that often help.",
      INTERACTIONS,
    ],
  },
  injection: {
    name: "Injection",
    summary: "It stops ovulation. Periods often become irregular, and many stop altogether after a few injections.",
    notes: [
      "A reminder for the next injection date keeps cover continuous.",
      "Periods can take several months to return after stopping.",
    ],
  },
  ring: {
    name: "Vaginal ring",
    summary: "Works like the combined pill: usually three weeks in and one week out, with a withdrawal bleed in the ring-free week.",
    notes: [
      "If the ring comes out, what to do depends on how long it was out — the leaflet says.",
      INTERACTIONS,
    ],
  },
  patch: {
    name: "Patch",
    summary: "Works like the combined pill: a new patch each week for three weeks, then a patch-free week with a withdrawal bleed.",
    notes: [
      "A patch that comes loose or a late change: the leaflet says what to do.",
      INTERACTIONS,
    ],
  },
}

/** When a doctor should hear about it — written plainly, without alarm. */
export const DOCTOR_SIGNS: string[] = [
  "Soaking through a pad or tampon every hour or two for several hours, or passing clots bigger than about 2.5 cm.",
  "A period lasting more than seven days.",
  "Pain that stops you doing normal things, or that painkillers do not help.",
  "Bleeding between periods or after sex.",
  "Cycles regularly shorter than 21 days or longer than 35, or no period for three months when not pregnant and not on a method that stops them.",
  "Premenstrual mood changes that seriously affect your life.",
  "Feeling faint, very tired or short of breath with heavy periods — signs of low iron.",
  "A sudden high fever and feeling very unwell while using a tampon or cup — rare, but it needs help straight away.",
]
