// The AI brief is cached per day, so its timestamp is usually today's — but a
// force-refresh moves it, and around midnight it can genuinely be yesterday's,
// which is exactly when the reader needs to see the date.
export function generatedLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return d.toDateString() === new Date().toDateString()
    ? `Generated at ${time}`
    : `Generated ${d.toLocaleDateString([], { day: "numeric", month: "short" })} at ${time}`
}
