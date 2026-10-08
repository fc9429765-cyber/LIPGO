# Scripts SQL

## Convención de nombres

Todo script nuevo lleva un **consecutivo de tres dígitos** al principio:

```
180_add_lo_que_sea.sql
181_verificar_lo_que_sea.sql
```

El número dice **en qué orden se fueron necesitando**, que es el orden en que
habría que correrlos en una instalación nueva. No es una fecha ni una versión.

**Para saber el siguiente número, pregúntalo. No lo adivines:**

```bash
pnpm run check:scripts -- --siguiente
```

Responde el siguiente libre de cada serie. Hacerlo así no es un capricho: cuando dos
personas trabajan a la vez, las dos miran el último archivo al mismo tiempo y las dos
toman el mismo número. Entonces la frase que más se usa en el día a día, *"corre el
244"*, deja de identificar un archivo. Pasó de verdad el 7 de octubre de 2026: en una
sola jornada quedaron duplicados el 241, el 243 y el 244.

Hay **10 números duplicados históricos**, congelados en
`scripts/scripts-numeros-duplicados.json`. No se renombran: un script que ya se corrió
debe conservar su nombre, o nadie sabe qué se ejecutó. Pero `pnpm run check:scripts`
corre en el pipeline y **falla si aparece uno nuevo**.

## Las carpetas

| Carpeta | Serie | Qué contiene |
|---|---|---|
| `scripts/` | `001`–`263` | Todo lo general: permisos, columnas, vistas, correcciones. **260–269 reservados** para las políticas por acción (2026-10-07): 260 cierre RLS, 261 reversa, 262 columnas de acción (generado: `npx tsx scripts/generar_262_permisos_acciones.mts`), 263 verificación |
| `scripts/sig/` | `01`–`63` | Sistema Integrado de Gestión. **Serie propia**, no se renumera |
| `scripts/auditoria/` | `01`–`06` | Triggers de auditoría. Serie propia |
| `scripts/diccionario/` | `01`– | Diccionario de datos. Serie propia. Ver su [README](diccionario/README.md) |

`scripts/sig/` conserva su numeración porque ya está corrida en Supabase:
renumerarla rompería la correspondencia entre lo que dice el repositorio y lo
que se ejecutó.

## Dos tipos de script

- **`NNN_add_*.sql`** — cambia la base. Hay que correrlo.
- **`NNN_verificar_*.sql`** — solo lecturas. Sirve para comprobar que el
  anterior quedó bien, y se puede correr las veces que haga falta.

## Cómo se escribe uno

1. **Encabezado que explique el porqué**, no solo el qué. Quien lo lea dentro de
   un año necesita saber qué problema resolvía.
2. **Aditivo e idempotente**: `add column if not exists`, `create table if not
   exists`. Correrlo dos veces no puede romper nada.
3. **Todo en `public`, y escrito**: `create table public.x`, no `create table x`.
4. **Verificación al final**, solo lecturas, para confirmar que quedó aplicado.

## Un solo esquema: `public`

Este proyecto usa **únicamente el esquema `public`**. La aplicación no llama
nunca a `.schema()`, así que cualquier tabla fuera de `public` es invisible para
LIPgo.

Por eso los scripts **escriben el esquema siempre**, aunque parezca redundante:

```sql
create table if not exists public.mi_tabla (...);   -- sí
create table if not exists mi_tabla (...);          -- no
```

Sin el prefijo, la tabla se crea donde diga el `search_path` de quien ejecuta
—que no es el mismo en el editor de Supabase, en una conexión directa o en un
rol distinto—. El script "funciona", no da ningún error, y la tabla queda en un
esquema que la aplicación nunca va a leer.

Ya pasó: apareció un `cobos.sig_satisfaccion`, una copia de la tabla de
encuestas en otro esquema. Una encuesta guardada ahí no cuenta en el indicador,
y nada lo avisa —el número simplemente sale más bajo de lo que debería—.

Si encuentras tablas fuera de `public`, no son de LIPgo.
4. **Reversión comentada**, con la advertencia de lo que NO se revierte (un
   archivo ya subido a Storage, un movimiento de inventario ya hecho).

Si el script toca nómina, facturación o inventario, decirlo en el encabezado:
son los que mueven dinero y merecen una lectura distinta.
