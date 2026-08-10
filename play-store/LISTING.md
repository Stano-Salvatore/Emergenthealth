# Google Play listing — Emergenthealth V3

Copy-paste source for the Play Console store listing. Keep this file in sync
with what is actually submitted.

## App details

- **App name:** `Emergenthealth` (14/30)
  Play caps the app name at 30 characters — the old value here,
  "Emergenthealth — AI Health Companion", was 36 and could not be submitted.
  Room for a short suffix if wanted: "Emergenthealth: AI Health" (25).
- **Package:** `app.emergenthealth`
- **Category:** Health & Fitness
- **Short description (max 80 chars):**
  > Your AI health companion. Habits, sleep, mood & wearables — with real insights.

## Full description (max 4000 chars)

> **Meet Emergy — the AI companion that actually knows your health.**
>
> Emergenthealth connects your wearables, habits, sleep, mood, and calendar in
> one place, then uses AI to tell you what actually matters: not just *what*
> happened, but *why* — and what to do next.
>
> **🌱 An AI that grows with you**
> Chat with Emergy about your day. It sees your real data — last night's sleep,
> today's habits, this week's mood — and gives grounded, personal answers. Get a
> daily brief every morning and a review every week.
>
> **✨ Correlations, not just charts**
> Most trackers show you graphs. Emergenthealth finds the connections: "You
> sleep 40 minutes longer on days you walk 8,000+ steps." "Your mood dips after
> late caffeine." Discover what actually affects your energy.
>
> **⌚ Works with your wearables**
> Syncs with Health Connect (Samsung Galaxy Watch, Fitbit, and more), Oura
> Ring, and Samsung Health. Steps, sleep stages, heart rate, HRV, SpO₂, weight
> and calories — automatically.
>
> **🗓️ Your calendar, your colours**
> Syncs your phone calendar — including Samsung per-event colour-coding — so
> your schedule and health live side by side.
>
> **✅ Habits that stick**
> Build habits with streaks, XP, daily quests, and a garden that thrives when
> you do. Log water and coffee straight from a home-screen widget.
>
> **Also inside:** morning check-ins, mood and journal, medications and
> vitamins, caffeine tracking, focus/Pomodoro timer, reminders, weight and
> body measurements, custom trackers, and location insights.
>
> **Private by design**
> Your data is yours: passkey sign-in, full export anytime, delete your account
> and all data in one tap. We never sell health data or use it for ads.
>
> New features ship regularly — updates land every few weeks.

<!-- Do not list held-back features in the description. Fasting is built but
     disabled in V3 (see src/lib/features.ts), so advertising it would promise
     something the shipped build does not have. Add each one back as its
     release goes out. -->

## Release notes template (per update)

> 🚀 V3.0 — Play Store launch!
> • Emergy AI chat, daily briefs & correlations
> • Health Connect, Oura & Samsung Health sync
> • Phone-calendar sync with your colours
> • Habits, streaks, garden & home-screen widgets
> More features land in every update — stay tuned. 🌱

## Assets checklist

Regenerate the first two with `npm run store-assets` (source of truth:
`.ci/brand-icon.mjs`). The script checks each output against Play's rules and
fails rather than writing a file Play would reject.

- [ ] App icon 512×512 — upload `play-store/assets/icon-512.png`

      Not `public/icons/icon-512.png`: that one is the PWA icon, which has
      transparent pre-rounded corners. Play applies its own corner mask, so a
      pre-rounded source shows a visible double curve, and Play rejects alpha
      on this slot. The generated file is square and fully opaque.

- [ ] Feature graphic 1024×500 — upload
      `play-store/assets/feature-graphic-1024x500.png`
- [ ] At least 4 phone screenshots (1080×1920+): Overview, Emergy chat,
      Health/correlations, Habits+Garden, Calendar
- [ ] Privacy policy URL: `https://emergenthealth.vercel.app/privacy`
- [ ] Account deletion URL: `https://emergenthealth.vercel.app/account-delete`

## Competitive positioning (why we win)

| Competitor | What they have | What we add |
|---|---|---|
| August (24/7 Health AI) | AI health chat | Chat **plus** your real wearable/habit data as context |
| Healthy4U | Multi-agent AI team | Correlations engine + gamified habits + widgets |
| Vora | Wearable-connected AI coach | Calendar context, garden gamification, journal + mood |
| Google Health Coach | Gemini + Fitbit only | Device-agnostic: Health Connect, Oura, Samsung |

Strategy: V3 ships the focused core above. Finished-but-flagged features
(finances, labs, Gmail, Strava, screen time, Last.fm, RescueTime, smart home)
are enabled one per release so the app visibly improves every few weeks.
