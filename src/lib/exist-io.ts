const BASE_URL = "https://exist.io/api/2"

interface ExistValue {
  date: string
  value: number | string | null
}

interface ExistAttributeResult {
  attribute: string
  label: string
  values: ExistValue[]
}

interface ExistResponse {
  count: number
  next: string | null
  results: ExistAttributeResult[]
}

// Returns { "2024-04-09": { steps: 8532, sleep: 420, ... }, ... }
export async function fetchExistHealthData(
  token: string,
  days = 7
): Promise<Record<string, Record<string, number | null>>> {
  const byDate: Record<string, Record<string, number | null>> = {}

  // Use limit param to get N most recent values per attribute
  let url: string | null = `${BASE_URL}/attributes/with-values/?limit=${days}`

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Token ${token}` },
      cache: "no-store",
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`exist.io API error ${res.status}: ${text}`)
    }
    const data: ExistResponse = await res.json()

    for (const attr of data.results ?? []) {
      for (const v of attr.values ?? []) {
        if (!byDate[v.date]) byDate[v.date] = {}
        byDate[v.date][attr.attribute] = typeof v.value === "number" ? v.value : null
      }
    }

    url = data.next ?? null
  }

  return byDate
}
