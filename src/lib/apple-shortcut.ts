// The ready-made Apple Health shortcut, shared as an iCloud link.
//
// Building the shortcut by hand is the hard part of connecting an iPhone.
// Once one person has built it, they share it from Shortcuts as an iCloud
// link and the owner puts it in APPLE_SHORTCUT_URL: every card then offers
// "Get the shortcut" — tap, paste your own key, done. Only an iCloud shortcut
// link is offered; anything else in the variable shows no button at all.

const ICLOUD_SHORTCUT = /^https:\/\/www\.icloud\.com\/shortcuts\/[A-Za-z0-9]+$/

export function readyShortcutUrl(): string | null {
  const v = process.env.APPLE_SHORTCUT_URL?.trim()
  return v && ICLOUD_SHORTCUT.test(v) ? v : null
}
