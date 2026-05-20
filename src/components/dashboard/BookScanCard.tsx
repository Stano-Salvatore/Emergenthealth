"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { BookOpen, Loader2, CheckCircle, XCircle, ScanLine } from "lucide-react"

interface BookResult {
  file: string
  book?: {
    title: string
    author: string
    isbn?: string
    confidence: "high" | "medium" | "low"
  }
  notionUrl?: string | null
  error?: string
}

export function BookScanCard() {
  const [scanning, setScanning] = useState(false)
  const [results, setResults] = useState<BookResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function scan() {
    setScanning(true)
    setError(null)
    setResults(null)
    try {
      const res = await fetch("/api/books", { method: "POST" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setResults(data.results ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed")
    } finally {
      setScanning(false)
    }
  }

  const confidenceColor = (c: string) =>
    c === "high" ? "text-green-400" : c === "medium" ? "text-amber-400" : "text-muted-foreground"

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <BookOpen className="h-4 w-4" /> Books
          </span>
          {results && (
            <Badge variant="secondary" className="text-xs">
              {results.length} scanned
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={scan}
          disabled={scanning}
          size="sm"
          className="w-full"
        >
          {scanning ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scanning…</>
          ) : (
            <><ScanLine className="h-4 w-4 mr-2" /> Scan Drive folder</>
          )}
        </Button>

        {error && (
          <p className="text-xs text-red-400 flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}

        {results && results.length === 0 && (
          <p className="text-sm text-muted-foreground">No images found in folder.</p>
        )}

        {results && results.length > 0 && (
          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={i} className="rounded-lg bg-secondary/50 px-3 py-2">
                {r.error ? (
                  <div className="flex items-center gap-1.5">
                    <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    <span className="text-xs text-muted-foreground truncate">{r.file}</span>
                  </div>
                ) : r.book ? (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-tight truncate">{r.book.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{r.book.author}</p>
                      </div>
                      <span className={`text-[10px] shrink-0 font-medium ${confidenceColor(r.book.confidence)}`}>
                        {r.book.confidence}
                      </span>
                    </div>
                    {r.notionUrl && (
                      <div className="flex items-center gap-1 mt-1">
                        <CheckCircle className="h-3 w-3 text-green-400 shrink-0" />
                        <a
                          href={r.notionUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary underline truncate"
                        >
                          Added to Notion
                        </a>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
