# Trampas del modelo de datos de LIPgo

Lo que `information_schema` **no** puede contarte, y que hace daño si no lo sabes.
El resto del diccionario se genera solo desde el esquema real y vive en
[diccionario-datos.md](diccionario-datos.md). Este archivo, en cambio, se escribe a mano:
son convenciones, deudas históricas y suciedad acumulada que ninguna consulta revela.

**Todo lo de aquí está comprobado contra la base, no supuesto.** Cada punto lleva la
evidencia. El 7 de octubre de 2026, cuatro de estas trampas costaron dos scripts rebotados
delante de gerencia y una conclusión falsa sobre 1.011 unidades de inventario.

> Antes de escribir una consulta o un SQL nuevo, mira este archivo y el generado.
> Cuesta dos minutos y evita el rato de explicar por qué un número salió mal.

---

## 1. Nombres de columna que casi nadie acierta a la primera

| Quieres | No es | Es |
|---|---|---|
| La fecha de un movimiento de inventario | `invtrans.fecha` | **`invtrans.creado`** |
| El código de movimiento | `invtrans.cod` | **`invtrans.cod_movimiento`** |
| El saldo de un lote | `saldoinvdetalle.cantidad` | **`saldoinvdetalle.stock_actual`** |
| Ligar el detalle a su orden de cargue | `detalleoc.ordendecargue` | **`detalleoc.idorden`** (o `numeroorden`) |
| Ligar el historial de lotes a su orden | `historicolotes.idorden` | **`historicolotes.ordendecargue`** |
| El código de un proceso de autorización | `autorizacion_procesos.proceso` | **`autorizacion_procesos.codigo`** |
| El correo de un usuario | `profiles.email` | está en **`auth.users`** (`auth.admin.listUsers`) |

**La trampa de fondo, y es seria: PostgREST devuelve `null` en silencio cuando pides una
columna que no existe.** Una consulta mal escrita no falla: informa ceros. Así es como una
revisión concluyó que una orden "no autorizaba nada" cuando sí autorizaba.

`saldoinvdetalle` además trae `stock_disp` y `stock_res`, y **`stock_actual` ya descuenta
las reservas** (las filas en `por descontar`), no solo las salidas aprobadas.

---

## 2. Tipos que sorprenden

- **`historicolotes.cantidad` es TEXTO.** `sum(cantidad)` falla con
  `function sum(text) does not exist`. Hay que castear `cantidad::numeric`. Comprobado el
  2026-10-07 que las 24.759 filas tienen texto numérico limpio, así que el casteo no revienta.
- **`pedidosdetalle.unidadespendientes` es una COLUMNA GENERADA** (`unidades - unidadescargadas`,
  comprobado en 25 de 25 filas). Escribirla falla con
  `column ... can only be updated to DEFAULT`. Se recalcula sola.
- `invtrans.cantidad`, `detalleoc.cantidad` y `saldoinvdetalle.stock_actual` sí son numéricas.
- `invtrans.creado` es `timestamptz`; PostgREST lo devuelve como `"2026-10-06T11:53:05+00:00"`.

El listado completo y siempre al día de columnas generadas y de columnas de texto con pinta
de número está arriba del diccionario generado: se calcula del esquema, así que no se queda viejo.

---

## 3. La hora de Bogotá etiquetada como UTC

`getColombiaISO()` (`lib/date-utils.ts`) devuelve `toISOString()` de un `Date` construido con
la **hora de pared de Bogotá**. O sea: la hora local con sufijo `Z`. No es UTC real.

Consecuencias prácticas:

- Para escribir una fecha a mano que quede **idéntica** a la que escribe la app, usa ese mismo
  formato: `'2026-10-06T10:00:48.000Z'`. Un literal así se guarda bien tanto si la columna es
  texto como si es `timestamptz`.
- **Al filtrar desde un script, recuerda que no es UTC.** Un `gte('creado', '...T17:00:00')`
  buscando "las 12:00 de Bogotá" no encuentra nada. Caso real del 2026-10-07.
- `getColombiaDate()` da `YYYY-MM-DD` y `getColombiaTime()` da `HH:MM:SS`.

---

## 4. El mismo dato escrito de varias formas

| Dónde | Qué pasa | Cómo se consulta |
|---|---|---|
| `invtrans.status` | Conviven `aprobado`, `Aprobado`, `Aprobaado`, `Aprrobado` | `like 'apr%'` o `ilike`, nunca igualdad |
| `invtrans.origen` | Conviven `orden de cargue`, `Orden de cargue`, `Orden de Cargue` | `lower(trim(origen))` o `ilike` |
| `pedidosdetalle.precio_und` | La **misma cifra en dos escalas**: 291 y 29.100 para el mismo producto | Para deducir cantidades, usar `total_linea`, no el unitario |
| `pedidosdetalle` | Dos columnas de cargado: `unidadescargadas` (la que lee el código) y `unidades_cargadas` (legado) | `coalesce(unidadescargadas, unidades_cargadas, 0)` |
| `pedidosdetalle.peso` | Es el peso de la **línea**, no el unitario | Si corriges unidades, corrige el peso |

Los nombres de producto también vienen con mayúsculas y espacios de más entre proyectos:
normaliza con `trim` + colapso de espacios + mayúsculas antes de comparar.

---

## 5. Llaves, unicidad y secuencias

- **`cabeceraoc` tiene códigos `ordendecargue` REPETIDOS.** 14 números ambiguos medidos el
  2026-10-07. Resolver una orden por su número puede traer la equivocada: **usa el `id`**.
- **La secuencia de `invtrans` está desfasada.** Un `insert` sin `id` explícito falla con
  `duplicate key value violates unique constraint "invtrans_pkey"`. Hay que calcular
  `max(id)+1` a mano. Ver `scripts/039_fix-invtrans-sequence.sql`.
- **Paginar exige un orden único.** Sin él se duplican o se pierden filas entre páginas; pasó
  de verdad con un día de más en vacaciones. Las llaves ya verificadas contra datos reales
  están en `lib/orden-paginacion.ts`, y `scripts/verificar_llaves_paginacion.mts` las comprueba.
  Hay fuentes con filas **idénticas en todas sus columnas** (`facturacion`, 213 casos) donde
  ningún `order by` desempata: ahí `lib/fetch-all-rows.ts` avisa en consola en vez de callar.
- `saldoinvdetalle` es una **vista** que agrupa por ocho columnas
  (`idempresa, idproducto, codproducto, nombreproducto, categoria, subcategoria, lote, location`).
  Ordenar solo por nombre, lote y ubicación **no es único**.

---

## 6. Las seis tablas núcleo son de solo lectura para la IA

`cabeceraoc`, `detalleoc`, `saldoinvdetalle`, `pedidoscabecera`, `pedidosdetalle` e `invtrans`
están en `NUCLEO_PROHIBIDO` (`lib/lipbot-registry.ts`): LIPbot puede leerlas y nunca escribirlas.
Las tablas donde sí puede escribir, con su permiso y su llave, están en el mismo archivo.

---

## 7. Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Columnas, tipos, llaves, generadas, foráneas | [diccionario-datos.md](diccionario-datos.md), generado |
| Qué módulo lee y escribe cada tabla | `inventario-modulos.md` |
| Llave primaria, columna de empresa y permisos | `lib/lipbot-registry.ts` |
| Columna de empresa de cada tabla | `lib/company-constants.ts` |
| Llaves únicas verificadas para paginar | `lib/orden-paginacion.ts` |
| Columnas y tipos de las vistas financieras | `docs/estructura-vistas-financieras.md` |
| Qué debe cuadrar con qué, y por qué | `lib/convergencia-checks.ts` |
| Convenciones para escribir scripts SQL | `scripts/README.md` |

---

## Cómo se mantiene esto

1. **Las descripciones se escriben en la base**, no aquí:
   `comment on table public.X is '...'` y `comment on column public.X.y is '...'`, en el mismo
   script SQL que crea la tabla. Así viajan pegadas al dato y nadie tiene que acordarse.
2. **El diccionario se regenera** con `pnpm run diccionario`, que lee el esquema real.
3. **El pipeline avisa** con `pnpm run check:diccionario` cuando el código usa una tabla que el
   diccionario no conoce, o cuando una tabla nueva llega sin descripción.
4. **Este archivo se escribe a mano.** Cuando una trampa nueva te haga perder una hora,
   escríbela aquí el mismo día. Es la única forma de que no se la coma el siguiente.
