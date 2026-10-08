"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase-client"
import { fetchAllRows } from "@/lib/fetch-all-rows"
import { Tolva } from "@/components/tolva"
import { Edit2, Eye, Trash2 } from "lucide-react"
import { eliminarTolva } from "@/lib/orders-actions"
import { useAuth } from "@/components/auth-provider"

interface TolvaRecord {
  id: number
  ordendecargue: string
  fechaorden: string
  auxiliares: string
  pesoorden: number
  status: string
  detalles?: Array<{
    id: number
    producto: string
    cantidad: number
    toneladas: number
  }>
}

export default function VerTolva() {
  const { selectedEmpresaId } = useAuth()
  const [tolvas, setTolvas] = useState<TolvaRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTolva, setSelectedTolva] = useState<TolvaRecord | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (selectedEmpresaId) {
      loadTolvas()
    }
  }, [selectedEmpresaId])

  const loadTolvas = async () => {
    try {
      setLoading(true)
      const supabase = await createClient()

      // Traemos tanto "Tolva" como "Tolva f" (este ultimo es el que
      // genera saveTolva cuando la fecha cae en domingo). Si filtramos
      // solo por "Tolva" los registros de domingo no apareceran en la
      // vista — mismo modulo, distinto sufijo.
      // PAGINADO con orden único (fechaorden desc, id): hoy son 379 tolvas en
      // ID1, pero la lista crece y Supabase corta en 1.000 sin avisar.
      let tolvasData: any[]
      try {
        tolvasData = await fetchAllRows((from, to) =>
          supabase
            .from("cabeceraoc")
            .select("*")
            .eq("idempresa", selectedEmpresaId)
            .in("tipooperacion", ["Tolva", "Tolva f"])
            .order("fechaorden", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to),
        )
      } catch (tolvasError) {
        console.error("[v0] Error loading tolvas:", tolvasError)
        toast({
          title: "Error",
          description: "Error al cargar las tolvas",
          variant: "destructive",
        })
        return
      }

      // Detalles en LOTES de 100 órdenes, paginados (antes: una consulta POR
      // tolva -- 379 peticiones al abrir la pestaña).
      const detallesPorOrden = new Map<number, NonNullable<TolvaRecord["detalles"]>>()
      const ids = tolvasData.map((t) => Number(t.id))
      for (let i = 0; i < ids.length; i += 100) {
        const lote = ids.slice(i, i + 100)
        const detalles = await fetchAllRows((from, to) =>
          supabase
            .from("detalleoc")
            .select("id, idorden, producto, cantidad, toneladas")
            .in("idorden", lote)
            .order("id")
            .range(from, to),
        )
        for (const d of detalles) {
          const arr = detallesPorOrden.get(Number(d.idorden)) || []
          arr.push({ id: d.id, producto: d.producto, cantidad: d.cantidad, toneladas: d.toneladas })
          detallesPorOrden.set(Number(d.idorden), arr)
        }
      }

      setTolvas(tolvasData.map((t) => ({ ...t, detalles: detallesPorOrden.get(Number(t.id)) || [] })) as TolvaRecord[])
    } catch (error) {
      console.error("[v0] Error loading tolvas:", error)
      toast({
        title: "Error",
        description: "Error al cargar las tolvas",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (tolva: TolvaRecord) => {
    setSelectedTolva(tolva)
    setIsEditing(true)
  }

  const handleBack = () => {
    setIsEditing(false)
    setSelectedTolva(null)
    loadTolvas()
  }

  const handleDelete = async (tolvaId: number) => {
    if (!confirm("¿Está seguro de que desea eliminar esta tolva?")) {
      return
    }

    try {
      // Server action con puerta (Ver Tolva › eliminar): borra detalleoc y cabeceraoc.
      const r = await eliminarTolva(tolvaId)
      if (!r.success) {
        toast({
          title: "Error",
          description: r.message || "Error al eliminar la tolva",
          variant: "destructive",
        })
        return
      }

      toast({
        title: "Éxito",
        description: "Tolva eliminada correctamente",
      })

      loadTolvas()
    } catch (error) {
      console.error("[v0] Error deleting tolva:", error)
      toast({
        title: "Error",
        description: "Error inesperado al eliminar la tolva",
        variant: "destructive",
      })
    }
  }

  if (isEditing && selectedTolva) {
    return (
      <div>
        <Button onClick={handleBack} variant="outline" className="mb-4 bg-transparent">
          Volver al listado
        </Button>
        {/* Modo edicion: solo se permite modificar la lista de empleados asignados.
            Todo el encabezado (fecha, lote) y la tabla de productos quedan bloqueados. */}
        <Tolva editingTolvaId={selectedTolva.id} readonly onClose={handleBack} />
      </div>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-gray-500">Cargando tolvas...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Listado de Tolvas</CardTitle>
        </CardHeader>
        <CardContent>
          {tolvas.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No hay tolvas registradas</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Orden</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Auxiliares</TableHead>
                    <TableHead>Peso (Ton)</TableHead>
                    <TableHead>Productos</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tolvas.map((tolva) => (
                    <TableRow key={tolva.id}>
                      <TableCell className="font-medium">{tolva.ordendecargue}</TableCell>
                      <TableCell>{tolva.fechaorden}</TableCell>
                      <TableCell className="text-sm">
                        <div className="flex flex-col gap-0.5">
                          {tolva.auxiliares?.split(",").map((aux, idx) => (
                            <span key={idx}>{aux.trim()}</span>
                          )) || "-"}
                        </div>
                      </TableCell>
                      <TableCell>{tolva.pesoorden.toFixed(2)}</TableCell>
                      <TableCell className="text-sm">
                        <div className="flex flex-col gap-0.5">
                          {tolva.detalles?.map((d, idx) => (
                            <span key={idx}>{d.producto}</span>
                          )) || <span>Sin detalles</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          {tolva.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleEdit(tolva)}
                            variant="outline"
                            size="sm"
                            className="gap-2"
                          >
                            <Edit2 className="w-4 h-4" />
                            Editar
                          </Button>
                          <Button
                            onClick={() => handleDelete(tolva.id)}
                            variant="destructive"
                            size="sm"
                            className="gap-2"
                          >
                            <Trash2 className="w-4 h-4" />
                            Eliminar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
