// Shared by the import route and the card, so the card can refuse a file
// before uploading it and the two cannot disagree about where the line is.

/**
 * Characters of data URL a lab import may send: about 3 MB of file.
 *
 * Vercel rejects a function request body over 4.5 MB with a plain-text 413
 * before the route runs, so a larger cap here would never be reached — the
 * user would get the platform's error instead of this route's message.
 */
export const LAB_IMPORT_MAX_CHARS = 4_200_000

export const LAB_IMPORT_TOO_LARGE =
  "That file is too large to send (over about 3 MB) — try a photo of each page instead."
