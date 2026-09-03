import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { localDateStr } from "@/lib/local-date"
import { loadSyncOverview } from "@/lib/sync-status-load"
import { agoLabel } from "@/lib/sync-status"
import { CHAT_ID_KEY } from "@/lib/telegram"
import { SAID_KEY, parseSaid } from "@/lib/emergy-say"
import { agoShort, dayLabel, freshnessTone, latestDayIn, type StatusRow } from "@/lib/status-rows"

// Everything the app is connected to, and when it last did its job — one
// query batch, one screen. Every line is something that was recorded or an
// honest "not connected"; nothing is called fine because it hasn't complained.

const PREF_KEYS = [
  CHAT_ID_KEY, "local_notifications_synced", "widget_api_key",
  "reminders_sent", "daily_nudges_sent", "emergy_push:sent", "wind_down_last_sent", SAID_KEY,
]

export async function loadStatusOverview(userId: string): Promise<{ rows: StatusRow[]; today: string }> {
  const timezone = await getUserTimezone(userId)
  const today = localDateStr(timezone)

  const [
    sync, lastfmKey, lastfmLog, rescueKey, rescueLog, screenLog, weatherLog, locationPoint, github,
    webPush, fcmCount, fcmNewest, prefs, lastReply, medSchedules,
  ] = await Promise.all([
    loadSyncOverview(userId),
    prisma.lastfmKey.count({ where: { userId } }).catch(() => 0),
    prisma.lastfmLog.findFirst({ where: { userId }, orderBy: { date: "desc" }, select: { date: true } }).catch(() => null),
    prisma.rescuetimeKey.count({ where: { userId } }).catch(() => 0),
    prisma.rescuetimeLog.findFirst({ where: { userId }, orderBy: { date: "desc" }, select: { date: true } }).catch(() => null),
    prisma.screenTimeLog.findFirst({ where: { userId }, orderBy: { date: "desc" }, select: { date: true } }).catch(() => null),
    prisma.weatherLog.findFirst({ where: { userId }, orderBy: { date: "desc" }, select: { date: true } }).catch(() => null),
    prisma.locationPoint.findFirst({ where: { userId }, orderBy: { trackedAt: "desc" }, select: { trackedAt: true } }).catch(() => null),
    prisma.gitHubProfile.findFirst({ where: { userId }, select: { username: true } }).catch(() => null),
    prisma.pushSubscription.count({ where: { userId } }).catch(() => 0),
    prisma.fcmToken.count({ where: { userId } }).catch(() => 0),
    prisma.fcmToken.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }).catch(() => null),
    prisma.userPreference.findMany({ where: { userId, key: { in: PREF_KEYS } }, select: { key: true, value: true } })
      .catch(() => [] as { key: string; value: string }[]),
    prisma.chatMessage.findFirst({ where: { userId, role: "assistant" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }).catch(() => null),
    prisma.medSchedule.count({ where: { userId, active: true } }).catch(() => 0),
  ])

  const pref = (key: string) => prefs.find(p => p.key === key)?.value ?? null
  const rows: StatusRow[] = []

  // ── Data sources ──────────────────────────────────────────────────────────
  for (const s of sync.sources) {
    if (!s.connected) {
      rows.push({ id: s.id, group: "Data", label: s.label, tone: "off", value: "not connected" })
      continue
    }
    if (!s.run) {
      rows.push({ id: s.id, group: "Data", label: s.label, tone: "warn", value: "connected, never synced" })
      continue
    }
    const when = agoLabel(s.run.at) ?? "unknown"
    if (!s.run.ok) {
      rows.push({ id: s.id, group: "Data", label: s.label, tone: "bad", value: `failed ${when}`, detail: s.run.error })
      continue
    }
    // A server source that should have run and hasn't is worth an amber; a
    // phone source only runs when the phone does, so it is never "late".
    const ageH = (Date.now() - Date.parse(s.run.at)) / 3600000
    const late = s.driver === "server" && ageH > 26
    const detail = s.id === "oura" && sync.newestHealthDate ? `data to ${dayLabel(sync.newestHealthDate, today)}` : undefined
    rows.push({ id: s.id, group: "Data", label: s.label, tone: late ? "warn" : "ok", value: `synced ${when}`, detail })
  }
  /**
   * A source we know by "has any log ever landed": screen time, weather, and
   * anything where the connection lives on the phone rather than as a key in
   * a table. Ancient data is not proof of a live link — it is proof of an
   * old one — so past staleAfterDays we call it what it is: went quiet.
   */
  const dayRow = (id: string, label: string, connected: boolean, day: string | null, warnAfter: number, staleAfterDays = 14) => {
    if (!connected) return rows.push({ id, group: "Data", label, tone: "off", value: "not connected" })
    if (!day) return rows.push({ id, group: "Data", label, tone: "warn", value: "connected, no data yet" })
    const ageDays = Math.max(0, Math.round((Date.parse(today + "T12:00:00Z") - Date.parse(day + "T12:00:00Z")) / 86400000))
    if (ageDays > staleAfterDays) {
      return rows.push({ id, group: "Data", label, tone: "off", value: `went quiet ${dayLabel(day, today)}` })
    }
    rows.push({ id, group: "Data", label, tone: freshnessTone(day, today, warnAfter), value: `data ${dayLabel(day, today)}` })
  }
  dayRow("lastfm", "Last.fm", lastfmKey > 0, lastfmLog?.date ?? null, 2)
  dayRow("rescuetime", "RescueTime", rescueKey > 0, rescueLog?.date ?? null, 2)
  dayRow("screentime", "Screen time", !!screenLog, screenLog?.date ?? null, 2)
  dayRow("weather", "Weather", !!weatherLog, weatherLog?.date ?? null, 1)
  if (locationPoint) {
    const ageH = (Date.now() - locationPoint.trackedAt.getTime()) / 3600000
    rows.push({ id: "location", group: "Data", label: "Location", tone: ageH > 12 ? "warn" : "ok", value: `last fix ${agoShort(locationPoint.trackedAt)}` })
  } else {
    rows.push({ id: "location", group: "Data", label: "Location", tone: "off", value: "no fixes yet" })
  }
  rows.push(github
    ? { id: "github", group: "Data", label: "GitHub", tone: "ok", value: `@${github.username}` }
    : { id: "github", group: "Data", label: "GitHub", tone: "off", value: "not connected" })

  // ── Notifications ─────────────────────────────────────────────────────────
  rows.push(fcmCount > 0
    ? { id: "fcm", group: "Notifications", label: "App push (phone)", tone: "ok", value: `${fcmCount} device${fcmCount === 1 ? "" : "s"}`, detail: fcmNewest ? `registered ${agoShort(fcmNewest.updatedAt)}` : undefined }
    : { id: "fcm", group: "Notifications", label: "App push (phone)", tone: process.env.FCM_SERVICE_ACCOUNT ? "off" : "warn", value: process.env.FCM_SERVICE_ACCOUNT ? "no device registered" : "not configured on the server" })
  rows.push(webPush > 0
    ? { id: "webpush", group: "Notifications", label: "Browser push", tone: "ok", value: `${webPush} browser${webPush === 1 ? "" : "s"}` }
    : { id: "webpush", group: "Notifications", label: "Browser push", tone: "off", value: "none" })
  const localSync = (() => { try { return JSON.parse(pref("local_notifications_synced") ?? "null") as { syncedAt?: string; windowDays?: number } | null } catch { return null } })()
  rows.push(localSync?.syncedAt
    ? { id: "local", group: "Notifications", label: "Phone reminders", tone: (Date.now() - Date.parse(localSync.syncedAt)) / 86400000 > 3 ? "warn" : "ok", value: `scheduled ${agoShort(localSync.syncedAt)}`, detail: localSync.windowDays ? `${localSync.windowDays} days ahead` : undefined }
    : { id: "local", group: "Notifications", label: "Phone reminders", tone: "off", value: "never scheduled" })
  const sentDays = ["reminders_sent", "daily_nudges_sent", "emergy_push:sent", "wind_down_last_sent"].map(k => latestDayIn(pref(k))).filter((d): d is string => !!d)
  const lastDelivery = sentDays.length ? sentDays.reduce((a, b) => (a > b ? a : b)) : null
  rows.push({
    id: "delivery", group: "Notifications", label: "Scheduled deliveries",
    tone: !process.env.CRON_SECRET ? "bad" : lastDelivery ? freshnessTone(lastDelivery, today, 1) : "off",
    value: !process.env.CRON_SECRET ? "CRON_SECRET missing — nothing runs" : lastDelivery ? `last sent ${dayLabel(lastDelivery, today)}` : "nothing sent yet",
  })
  rows.push(pref(CHAT_ID_KEY)
    ? { id: "telegram", group: "Notifications", label: "Telegram", tone: "ok", value: "linked" }
    : { id: "telegram", group: "Notifications", label: "Telegram", tone: "off", value: process.env.TELEGRAM_BOT_TOKEN ? "not linked" : "not set up" })
  rows.push({
    id: "email", group: "Notifications", label: "Email",
    tone: !process.env.RESEND_API_KEY ? "off" : process.env.EMAIL_FROM?.trim() ? "ok" : "warn",
    value: !process.env.RESEND_API_KEY ? "not configured" : process.env.EMAIL_FROM?.trim() ? "ready" : "sandbox sender — reaches only the owner",
  })
  rows.push(pref("widget_api_key")
    ? { id: "widget", group: "Notifications", label: "Home-screen widgets", tone: "ok", value: "activated" }
    : { id: "widget", group: "Notifications", label: "Home-screen widgets", tone: "off", value: "not activated" })

  // ── Emergy ────────────────────────────────────────────────────────────────
  rows.push(process.env.ANTHROPIC_API_KEY
    ? { id: "emergy", group: "Emergy", label: "Emergy", tone: "ok", value: lastReply ? `last replied ${agoShort(lastReply.createdAt)}` : "ready, never chatted" }
    : { id: "emergy", group: "Emergy", label: "Emergy", tone: "bad", value: "ANTHROPIC_API_KEY missing" })
  const said = parseSaid(pref(SAID_KEY))
  rows.push({ id: "said", group: "Emergy", label: "Nudges from him", tone: said.length ? "ok" : "off", value: said.length ? `last ${agoShort(said[0].at)}` : "none yet" })
  rows.push({ id: "meds", group: "Emergy", label: "Medication schedules", tone: medSchedules ? "ok" : "off", value: medSchedules ? `${medSchedules} active` : "none" })

  return { rows, today }
}
