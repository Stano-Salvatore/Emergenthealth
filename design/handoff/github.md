repo: Stano-Salvatore/Emergenthealth
branch: main

## Last sync

date: 2026-08-11T19:36:00Z

### Updated in this project

- Whole-app proposal: Today, Body, Log, Patterns, Emergy and Settings, each drawn for mobile and web.
- Log and Patterns are new rooms, composed from intake/caffeine/medications and insights/streaks.
- App.dc.html indexes the set and states the palette, icon and type rules every page obeys.

## Previous sync

date: 2026-08-11T19:24:07Z

### Updated in this project

- Design review of the current app: colour-semantics audit, icon and type findings, IA proposal.
- Page 1 (Today) redesigned for mobile 390px and web 1280px on the proposed palettes.
- Emergy reproduced from EmergySVG.tsx (state "okay") in the nav button, sidebar mark and prompt card.
- Today header rebuilt from source: greeting, LiveClock, WeatherWidget forecast, DailyBriefing, MoodWidget, TodayStrip.
- Emergy rebuilt as a live 3D avatar (emergy-model.js / emergy-avatar.js) and mounted across the mockups.
- Page 2 (Body) redesigned for mobile and web from the Health & Body page and its tab bar.

## Sync history

- 2026-08-11T15:56:31Z — read shell, tokens, nav, base components; audited 381 colour literals; rebuilt mobile Today as the "before" specimen.

## Screen map

| Project screen | Built from |
| --- | --- |
| Design Review.dc.html — audit findings | src/app/globals.css, src/app/layout.tsx, src/components/ui/card.tsx, src/components/ui/button.tsx |
| Design Review.dc.html — IA section | src/components/layout/Sidebar.tsx, src/components/layout/BottomNav.tsx, src/components/layout/DashboardShell.tsx, src/app/dashboard/layout.tsx |
| Design Review.dc.html — mobile Today before/after | src/components/dashboard/MobileToday.tsx, src/components/dashboard/QuickLog.tsx |
| Today.dc.html — mobile + web Today | src/components/dashboard/MobileToday.tsx, src/components/dashboard/QuickLog.tsx, src/components/layout/Sidebar.tsx, src/components/layout/BottomNav.tsx, src/components/emergy/EmergySVG.tsx, src/components/dashboard/LiveClock.tsx, src/components/dashboard/WeatherWidget.tsx, src/components/dashboard/DailyBriefing.tsx, src/components/dashboard/MoodWidget.tsx, src/components/dashboard/TodayStrip.tsx, src/app/globals.css |
| Body.dc.html — mobile + web Body | src/app/dashboard/health/page.tsx, src/components/health/HealthTabBar.tsx, src/components/health/HealthCharts.tsx, src/app/dashboard/body/page.tsx, src/app/globals.css |
| emergy-model.js / emergy-avatar.js — 3D mascot | src/components/emergy/EmergySVG.tsx |
| Log.dc.html | src/app/dashboard/intake/page.tsx, src/app/dashboard/caffeine/page.tsx, src/app/dashboard/medications/page.tsx, src/components/dashboard/QuickLog.tsx |
| Patterns.dc.html | src/app/dashboard/insights/page.tsx, src/app/dashboard/streaks/page.tsx, src/components/dashboard/WatchedPatterns.tsx |
| Emergy.dc.html | src/app/dashboard/chat/page.tsx, src/components/emergy/EmergySVG.tsx, src/components/emergy/ChatMarkdown.tsx |
| Settings.dc.html | src/app/dashboard/settings/page.tsx, src/components/settings/* |
| App.dc.html (index) | src/components/layout/Sidebar.tsx, src/components/layout/BottomNav.tsx |
| Colour audit evidence | src/app/dashboard/**/page.tsx (health, finances, intake, habits, reminders, body, rescuetime, labs, medications, calendar, insights) |
