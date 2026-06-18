import type { Metadata } from "next"
export const metadata: Metadata = { title: "Location Insights" }

import LocationInsightsClient from "./LocationInsightsClient"

export default function LocationInsightsPage() {
  return <LocationInsightsClient />
}
