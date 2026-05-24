"use client"

import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"

export function ExportButton() {
  function handleClick() {
    window.location.href = "/api/export"
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} className="gap-1.5">
      <Download className="h-3.5 w-3.5" />
      Download CSV
    </Button>
  )
}
