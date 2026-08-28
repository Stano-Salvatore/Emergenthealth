// Fills a local database with a demo account and 30 days of invented data, so
// the UI has something to render and the smoke test has something to look at.
//
//   node .ci/dev-seed.mjs
//
// The data is made up, deterministic (a sine wobble, not Math.random, so two
// runs are comparable) and includes a run of short nights so the trend lines
// have a story rather than a flat line. It also mints a session row, which is
// what lets a browser sign in without Google — the app uses database sessions,
// so a cookie carrying this token IS a signed-in session.
//
// Refuses to run against anything but a local database. See docs/local-dev.md.
import { config } from "dotenv"
import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { neonConfig } from "@neondatabase/serverless"

config({ path: ".env.local", override: true })

const url = process.env.DATABASE_URL ?? ""
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to seed: DATABASE_URL is not a local database.\n  " + (url || "(unset)"))
  process.exit(1)
}

// Same bridge the app uses locally — see .ci/dev-wsproxy.mjs.
neonConfig.wsProxy = (host, port) => `127.0.0.1:${process.env.WSPROXY_PORT ?? 5434}/v1?address=${host}:${port}`
neonConfig.useSecureWebSocket = false
neonConfig.pipelineTLS = false
neonConfig.pipelineConnect = false
neonConfig.webSocketConstructor = globalThis.WebSocket

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) })

/** The session cookie value the smoke test presents. Local only, by construction. */
const TOKEN = "demo-session-token-local-only"
const day = (n) => { const d = new Date(); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate() - n); return d }
const at = (n, h, m = 0) => { const d = day(n); d.setUTCHours(h, m, 0, 0); return d }
// Deterministic wobble so runs are comparable.
const wob = (i, span, seed = 1) => Math.round(Math.sin(i * seed * 1.7) * span)

const user = await prisma.user.upsert({
  where: { email: "demo@local.test" },
  update: {},
  create: { email: "demo@local.test", name: "Sal", emailVerified: new Date() },
})

await prisma.session.deleteMany({ where: { userId: user.id } })
await prisma.session.create({
  data: { sessionToken: TOKEN, userId: user.id, expires: new Date(Date.now() + 7 * 864e5) },
})

for (let i = 0; i < 30; i++) {
  // A run of short nights around a week ago, so the trend lines have a story.
  const rough = i >= 5 && i <= 8
  const dur = (rough ? 330 : 445) + wob(i, 35)
  await prisma.healthLog.upsert({
    where: { userId_date: { userId: user.id, date: day(i) } },
    update: {},
    create: {
      userId: user.id, date: day(i),
      sleepStart: at(i + 1, 23, 20), sleepEnd: at(i, 7, 5),
      sleepDuration: dur,
      deepSleep: Math.round(dur * 0.19), remSleep: Math.round(dur * 0.22), lightSleep: Math.round(dur * 0.59),
      sleepScore: (rough ? 62 : 82) + wob(i, 6, 2),
      sleepEfficiency: (rough ? 80 : 91) + wob(i, 3, 3),
      readinessScore: (rough ? 65 : 84) + wob(i, 5, 4),
      activityScore: 78 + wob(i, 9, 5),
      steps: (rough ? 4200 : 9100) + wob(i, 1800, 6),
      caloriesBurned: 2350 + wob(i, 180, 7),
      activeMinutes: 41 + wob(i, 18, 8),
      restingHR: (rough ? 62 : 55) + wob(i, 3, 9),
      hrv: (rough ? 38 : 58) + wob(i, 7, 10),
      spo2: 96.4, breathingRate: 14.2, distanceKm: 6.8 + wob(i, 2, 11),
      weight: 78.4 + wob(i, 6, 12) / 10,
    },
  })
  await prisma.moodLog.upsert({
    where: { userId_date: { userId: user.id, date: day(i) } },
    update: {},
    create: { userId: user.id, date: day(i), mood: rough ? 2 : (i % 5 === 0 ? 5 : 4) },
  })
}

await prisma.dailyNote.upsert({
  where: { userId_date: { userId: user.id, date: day(1) } },
  update: {},
  create: { userId: user.id, date: day(1),
    content: "Long day. Got out for a walk at dusk which helped more than I expected. Coffee after 4pm again — that is the third time this week." },
})
await prisma.dailyNote.upsert({
  where: { userId_date: { userId: user.id, date: day(6) } },
  update: {},
  create: { userId: user.id, date: day(6), content: "Barely slept. Wired until 2am." },
})

const habits = [
  { name: "Morning walk", icon: "🚶", color: "#a3e635" },
  { name: "No coffee after 2pm", icon: "☕", color: "#22d3ee" },
  { name: "Read 20 minutes", icon: "📖", color: "#c084fc" },
  { name: "Stretch", icon: "🧘", color: "#818cf8" },
]
await prisma.habitCompletion.deleteMany({ where: { userId: user.id } })
await prisma.habit.deleteMany({ where: { userId: user.id } })
for (const [hi, h] of habits.entries()) {
  const habit = await prisma.habit.create({ data: { ...h, userId: user.id } })
  for (let i = 0; i < 21; i++) {
    if ((i + hi) % 3 === 0) continue
    await prisma.habitCompletion.create({
      data: { habitId: habit.id, userId: user.id, date: day(i), completedAt: at(i, 8) },
    })
  }
}

await prisma.intakeLog.deleteMany({ where: { userId: user.id } })
for (let i = 0; i < 14; i++) {
  for (const [h, ml, type] of [[8, 300, "water"], [9, 250, "coffee"], [12, 500, "water"], [15, 400, "water"], [19, 350, "water"]]) {
    await prisma.intakeLog.create({ data: { userId: user.id, type, amountMl: ml, loggedAt: at(i, h) } })
  }
}

await prisma.foodLog.deleteMany({ where: { userId: user.id } })
const meals = [
  ["Porridge with berries", "breakfast", 380, 12, 58, 9],
  ["Chicken caesar salad", "lunch", 540, 41, 18, 31],
  ["Salmon, rice and greens", "dinner", 620, 44, 55, 24],
]
for (let i = 0; i < 7; i++) {
  for (const [n, [name, mealType, calories, proteinG, carbsG, fatG]] of meals.entries()) {
    await prisma.foodLog.create({
      data: { userId: user.id, name, mealType, calories, proteinG, carbsG, fatG,
        loggedAt: at(i, 8 + n * 5), place: "Karlova Ves, Bratislava" },
    })
  }
}

await prisma.savedPlace.deleteMany({ where: { userId: user.id } })
const places = [
  { name: "Home", emoji: "🏠", lat: 48.1486, lng: 17.1077 },
  { name: "Elicea", emoji: "🏢", lat: 48.1520, lng: 17.1180 },
  { name: "Atarax", emoji: "🏢", lat: 48.1445, lng: 17.0990 },
]
await prisma.checkIn.deleteMany({ where: { userId: user.id } })
for (const p of places) {
  const sp = await prisma.savedPlace.create({ data: { ...p, userId: user.id } }).catch(() => null)
  for (let i = 0; i < 6; i++) {
    await prisma.checkIn.create({
      data: { userId: user.id, place: p.name, emoji: p.emoji, checkedAt: at(i, p.name === "Home" ? 20 : 10),
        isAuto: true, savedPlaceId: sp?.id ?? null },
    })
  }
}

await prisma.symptomLog.deleteMany({ where: { userId: user.id } }).catch(() => {})
console.log(`seeded ${user.id} — sign in with cookie authjs.session-token=${TOKEN}`)
await prisma.$disconnect()
