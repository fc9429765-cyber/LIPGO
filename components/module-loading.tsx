import { Loader2 } from "lucide-react"

// Placeholder mientras se descarga el chunk de un módulo cargado con next/dynamic.
export function ModuleLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}
