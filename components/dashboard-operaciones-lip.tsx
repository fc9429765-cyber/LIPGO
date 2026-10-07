"use client"

import { useState } from "react"
import { LayoutDashboard, CalendarRange } from "lucide-react"
import { cn } from "@/lib/utils"
import { LipDailyOperations } from "@/components/lip-daily-operations"
import { LipHistoricalOperations } from "@/components/lip-historical-operations"

// Solo presentación (gerencia 2026-10-05): las mismas dos pestañas con el mismo estado;
// pintadas como pestañas internas del sistema visual LIPgo en vez de dos botones.
const PESTANAS: { key: "daily" | "monthly"; label: string; Icon: typeof LayoutDashboard }[] = [
  { key: "daily", label: "Operacion del Dia", Icon: LayoutDashboard },
  { key: "monthly", label: "Historico Mensual", Icon: CalendarRange },
]

export function DashboardOperacionesLip() {
  const [activeTab, setActiveTab] = useState<"daily" | "monthly">("daily")

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border pb-2 [scrollbar-width:thin]" role="tablist" aria-label="Vista del dashboard">
        {PESTANAS.map(({ key, label, Icon }) => {
          const activa = activeTab === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => setActiveTab(key)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors",
                activa ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "daily" && <LipDailyOperations />}
      {activeTab === "monthly" && <LipHistoricalOperations />}
    </div>
  )
}
