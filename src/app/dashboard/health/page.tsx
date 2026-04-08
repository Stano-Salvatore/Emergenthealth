import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { HealthEntryForm } from "@/components/health/HealthEntryForm"
import { Moon, Footprints, Flame, Heart } from "lucide-react"
import { format } from "date-fns"

const STEP_GOAL = 8000

export default async function HealthPage() {
  const session = await auth()
  const logs = await prisma.healthLog.findMany({
    where: { userId: session!.user.id },
    orderBy: { date: "desc" },
    take: 8,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Health</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Log sleep, steps, and workouts manually
          </p>
        </div>
        <HealthEntryForm />
      </div>

      {logs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Moon className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No health data yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Click &quot;Log Day&quot; to add your first entry
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const sleepH = log.sleepDuration != null ? log.sleepDuration / 60 : null
            const stepsPercent = log.steps != null ? Math.min((log.steps / STEP_GOAL) * 100, 100) : null
            const goalMet = log.steps != null && log.steps >= STEP_GOAL

            return (
              <Card key={log.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-medium">
                      {format(log.date, "EEE, MMM d")}
                    </CardTitle>
                    {log.steps != null && (
                      <Badge variant={goalMet ? "default" : "secondary"} className="text-xs">
                        {goalMet ? "Goal met ✓" : "Goal missed"}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <StatBox
                      icon={<Moon className="h-4 w-4 text-indigo-400" />}
                      label="Sleep"
                      value={sleepH != null ? `${sleepH.toFixed(1)}h` : "—"}
                    />
                    <StatBox
                      icon={<span className="text-sm">💤</span>}
                      label="Deep / REM"
                      value={
                        log.deepSleep != null || log.remSleep != null
                          ? `${log.deepSleep ?? "?"}m / ${log.remSleep ?? "?"}m`
                          : "—"
                      }
                    />
                    <StatBox
                      icon={<Footprints className="h-4 w-4 text-green-400" />}
                      label="Steps"
                      value={log.steps != null ? log.steps.toLocaleString() : "—"}
                    />
                    <StatBox
                      icon={<Heart className="h-4 w-4 text-red-400" />}
                      label="Resting HR"
                      value={log.restingHR != null ? `${log.restingHR} bpm` : "—"}
                    />
                  </div>

                  {stepsPercent != null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Steps to goal</span>
                        <span>{log.steps!.toLocaleString()} / {STEP_GOAL.toLocaleString()}</span>
                      </div>
                      <Progress value={stepsPercent} className="h-1.5" />
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  )
}
