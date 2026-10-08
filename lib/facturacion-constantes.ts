// Constantes compartidas de facturación. Archivo NORMAL (no "use server"):
// varios de los archivos de acciones son "use server" y solo pueden exportar
// funciones async, así que estas constantes viven aparte para que los
// componentes cliente las puedan importar directo.

// Desde esta fecha el backlog de facturación se gestiona DENTRO de LIPgo
// (déficit de volumen del Análisis Financiero, "Sin gestionar" del Cuadro de
// Control, badge de pendientes, Solicitar Facturas). Antes de esta fecha los
// cuadros de acuerdo apenas se estaban montando y el backlog de esos meses YA
// SE FACTURÓ MANUAL, fuera del sistema (confirmado por gerencia 2026-08-02) —
// seguir mostrándolo como alarma/pendiente abierto sería engañoso. No se borra
// ni se oculta nada: es el PISO POR DEFECTO de los filtros de fecha de cada
// módulo (el usuario siempre puede cambiar la fecha a mano para ver el
// histórico completo), igual al patrón que ya usan los indicadores SST
// ("mes actual" + botón "Ver histórico").
export const GESTION_LIPGO_DESDE = "2026-07-01"
