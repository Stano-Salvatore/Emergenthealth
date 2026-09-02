// WMO weather interpretation codes (what Open-Meteo returns as weatherCode),
// reduced to one emoji and one word. Three components carried their own copy
// of this table and had drifted apart on where "sunny" stopped and "cloudy"
// began; this is the one that remains.
//
//   0–1  clear / mainly clear      45–48 fog          71–77 snow
//   2–3  partly cloudy / overcast  51–67 drizzle/rain 80–82 showers
//                                                     85+   snow showers, thunder

export function weatherEmoji(code: number | null | undefined): string {
  if (code == null || code <= 1) return "☀️"
  if (code <= 3) return "⛅"
  if (code <= 48) return "🌫️"
  if (code <= 67) return "🌧️"
  if (code <= 77) return "❄️"
  if (code <= 82) return "🌦️"
  return "⛈️"
}

export function weatherLabel(code: number | null | undefined): string {
  if (code == null || code <= 1) return "Sunny"
  if (code <= 3) return "Cloudy"
  if (code <= 48) return "Foggy"
  if (code <= 67) return "Rainy"
  if (code <= 77) return "Snowy"
  if (code <= 82) return "Showers"
  return "Stormy"
}
