"use client"

import { useEffect, useState } from "react"

export function LiveClock() {
  const [time, setTime] = useState("")

  useEffect(() => {
    const update = () =>
      setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  return <span className="tabular-nums font-mono text-2xl font-bold">{time}</span>
}
