# Diccionario de datos

Qué es cada tabla, cada columna y cada llave de LIPgo, **generado del esquema real** para que
no pueda mentir.

## Por qué

Un diccionario escrito a mano se desactualiza en semanas y entonces miente, que es peor que no
tenerlo. Este se genera. Lo único que escribe una persona son las **descripciones**, y viven
dentro de Postgres como comentarios, pegadas a la columna que describen.

El 7 de octubre de 2026, no tenerlo costó en una sola jornada dos scripts rebotados delante de
gerencia y una conclusión falsa sobre 1.011 unidades de inventario: una columna de texto donde
se esperaba un número, una columna generada que no se puede escribir, una tabla que se liga por
otra llave y un saldo que vive en otra columna.

## Cómo se usa

```bash
# 1. UNA sola vez (y otra cada que cambie la función): en el editor SQL de Supabase
#    scripts/diccionario/01_funcion_diccionario.sql

# 2. Generar o regenerar el documento
pnpm run diccionario

# 3. Verificar (esto corre solo en el pipeline)
pnpm run check:diccionario
```

Sale en `docs/diccionario-datos.md` para leerlo y `docs/diccionario-datos.json` para que lo lea
el comprobador. Los dos se versionan en git, así que se puede consultar sin conectarse a la base
y se ve en el diff cuándo cambió el esquema.

## Las piezas

| Archivo | Qué hace |
|---|---|
| `scripts/diccionario/01_funcion_diccionario.sql` | Instala `public.diccionario_esquema()`, que lee los catálogos de Postgres y devuelve el esquema como JSON. Solo lectura. |
| `scripts/generar-diccionario.mts` | Llama a esa función y escribe los dos documentos. |
| `scripts/check-diccionario.mjs` | Corre en el pipeline, sin base de datos. |
| `docs/diccionario-trampas.md` | Lo que el esquema no puede contar. Se escribe a mano. |
| `scripts/diccionario-pendientes.json` | La deuda conocida: tablas que todavía no tienen descripción. Solo debería encoger. |

## Qué vigila el comprobador

1. **Que el diccionario no se quede viejo.** Recorre el código buscando `.from("tabla")` y lo
   compara contra las tablas que el diccionario conoce. Si el código usa una tabla que no está,
   alguien creó una tabla y no regeneró.
2. **Que una tabla nueva no llegue sin descripción.** Las que hoy no la tienen están en la línea
   base y no rompen nada; una nueva sí.

Si una tabla de verdad no toca describirla ahora:

```bash
pnpm run check:diccionario -- --update-baseline
```

## Cómo se describe una tabla

En el mismo script SQL que la crea, nunca en un documento aparte:

```sql
comment on table public.mi_tabla is 'Para qué sirve, en una frase, en lenguaje de operación.';
comment on column public.mi_tabla.mi_columna is 'Qué guarda y en qué unidad. Si tiene truco, decirlo.';
```

El proyecto ya tiene 121 comentarios repartidos en 57 scripts: esto no inventa una práctica
nueva, la ordena y la hace visible.
