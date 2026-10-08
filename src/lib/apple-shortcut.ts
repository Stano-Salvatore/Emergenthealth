// The ready-made Apple Health shortcut, shared as an iCloud link.
//
// Building the shortcut by hand is the hard part of connecting an iPhone.
// Once one person has built it, they share it from Shortcuts as an iCloud
// link and the owner puts it in APPLE_SHORTCUT_URL: every card then offers
// "Add the shortcut" then "Connect", which hands the key to the shortcut
// through Shortcuts' own URL scheme — nothing to copy or paste. Only an
// iCloud shortcut link is offered; anything else in the variable shows no
// button at all.

const ICLOUD_SHORTCUT = /^https:\/\/www\.icloud\.com\/shortcuts\/[A-Za-z0-9]+$/

/** What the shortcut is called: "Send now" and "Connect" find it by name. */
export const SHORTCUT_NAME = "Emergenthealth"

export function readyShortcutUrl(): string | null {
  const v = process.env.APPLE_SHORTCUT_URL?.trim()
  return v && ICLOUD_SHORTCUT.test(v) ? v : null
}

/** Runs the shortcut now — it reads the key it saved when connected. */
export function runShortcutUrl(): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`
}

/**
 * Runs the shortcut with the key as its input. The shared shortcut saves an
 * input starting `ah_` to a file and every later run, automations included,
 * reads it from there. The URL is opened on the phone and goes nowhere else.
 */
export function connectShortcutUrl(key: string): string {
  return `${runShortcutUrl()}&input=text&text=${encodeURIComponent(key)}`
}
