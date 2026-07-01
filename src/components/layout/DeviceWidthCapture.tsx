"use client"

import { useEffect } from "react"
import { captureDeviceWidth } from "@/lib/display-scale"

// Persists the device's CSS-pixel width into a cookie so the server can
// render an accurate `width = deviceWidth / zoom` viewport <meta> on the next
// request — see src/lib/display-scale.ts for why this has to happen
// server-side rather than via a client-side DOM mutation.
export function DeviceWidthCapture() {
  useEffect(() => {
    captureDeviceWidth()
  }, [])
  return null
}
