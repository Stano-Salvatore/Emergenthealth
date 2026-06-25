"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"

export function RefCapture() {
  const searchParams = useSearchParams()

  useEffect(() => {
    const ref = searchParams.get("ref")
    if (ref && /^[a-z0-9]{6,12}$/.test(ref)) {
      localStorage.setItem("eh_referral_code", ref)
    }
  }, [searchParams])

  return null
}
