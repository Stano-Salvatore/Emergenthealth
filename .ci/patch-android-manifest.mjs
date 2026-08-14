// Add SCHEDULE_EXACT_ALARM to the generated Android manifest.
//
// @capacitor/local-notifications declares RECEIVE_BOOT_COMPLETED, WAKE_LOCK and
// POST_NOTIFICATIONS in its own manifest, which the merger folds in — but not
// SCHEDULE_EXACT_ALARM. Its README is explicit that the app has to declare that
// one itself, and `npx cap add android` generates a fresh manifest every build,
// so there's nowhere to put it by hand.
//
// Without it, checkExactNotificationSetting() can never come back granted and
// every reminder falls through to setAndAllowWhileIdle — Android is then free
// to batch it, so a 07:30 dose arrives at "07:30-ish" and in Doze considerably
// later. With it, the user can grant "Alarms & reminders" and the time they
// picked is the time it fires.
//
// USE_EXACT_ALARM would skip the prompt, but Play reserves it for alarm-clock
// and calendar apps. This isn't one, so SCHEDULE_EXACT_ALARM plus an in-app
// opt-in is the honest route.

import { readFileSync, writeFileSync, existsSync } from "node:fs"

const MANIFEST = "android/app/src/main/AndroidManifest.xml"
const PERMISSION = "android.permission.SCHEDULE_EXACT_ALARM"

if (!existsSync(MANIFEST)) {
  console.error(`✗ ${MANIFEST} not found — run this after "npx cap add android".`)
  process.exit(1)
}

const xml = readFileSync(MANIFEST, "utf8")

if (xml.includes(PERMISSION)) {
  console.log(`✓ ${PERMISSION} already present`)
  process.exit(0)
}

// Sit alongside the permissions the merger already brought in, just before the
// closing tag — valid anywhere at manifest level, and this keeps them together.
const line = `    <uses-permission android:name="${PERMISSION}" />\n`
const patched = xml.replace(/<\/manifest>/, `${line}</manifest>`)

if (patched === xml) {
  console.error("✗ No </manifest> to insert before — manifest format changed?")
  process.exit(1)
}

writeFileSync(MANIFEST, patched)
console.log(`✓ Added ${PERMISSION}`)
