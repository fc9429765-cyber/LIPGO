// GENERADOR DEL SQL 262 (columnas de acción + siembra + procesos nuevos + modo).
//
// Es una función PURA sobre el catálogo (lib/politicas-modulos.ts) para que:
//   · scripts/generar_262_permisos_acciones.mts escriba el archivo, y
//   · tests/politicas-modulos.test.ts compruebe que el archivo versionado es
//     exactamente lo que el catálogo produce hoy (si alguien toca el catálogo
//     y olvida regenerar el SQL, la prueba falla).
//
// El SQL es IDEMPOTENTE y la siembra ocurre SOLO al crear la columna: volver a
// correrlo no re-otorga una acción que un administrador ya quitó.

import { POLITICAS, PROCESOS_NUEVOS, clavesDeAcciones, llaveDeModulo, paresLlaveAccion } from "@/lib/politicas-modulos"

function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** Proceso nuevo → llaves de módulo de las pantallas que lo declaran (para sembrar perfiles). */
export function procesosNuevosPorLlave(): { proceso: string; llave: string }[] {
  const out: { proceso: string; llave: string }[] = []
  for (const p of PROCESOS_NUEVOS) {
    const llaves = new Set<string>()
    for (const [modulo, pol] of Object.entries(POLITICAS)) {
      for (const v of Object.values(pol.conClave ?? {})) {
        const codigos = Array.isArray(v) ? (v as readonly string[]) : [v as string]
        if (!codigos.includes(p.codigo)) continue
        const llave = llaveDeModulo(modulo)
        if (llave) llaves.add(llave)
      }
    }
    for (const llave of [...llaves].sort()) out.push({ proceso: p.codigo, llave })
  }
  return out
}

export function sql262(): string {
  const pares = paresLlaveAccion()
  const llaves = Array.from(new Set(pares.map((p) => p.llave))).sort()
  const valores = pares.map((p) => `    (${lit(p.llave)}, ${lit(p.accion)})`).join(",\n")
  const procesos = PROCESOS_NUEVOS.map(
    (p) => `  (${lit(p.codigo)}, ${lit(p.nombre)}, ${lit(p.descripcion)}, ${lit(p.grupo)}, ${p.orden}, ${p.con_alcance ? "true" : "false"})`,
  ).join(",\n")
  const procesoLlaves = procesosNuevosPorLlave()
    .map((x) => `    (${lit(x.proceso)}, ${lit(x.llave)})`)
    .join(",\n")

  return `-- 262 · POLÍTICAS POR ACCIÓN — columnas de acción, siembra, procesos nuevos y modo.
--
-- GENERADO desde lib/politicas-modulos.ts por scripts/generar_262_permisos_acciones.mts.
-- NO EDITAR A MANO: cambia el catálogo y regenera (la prueba tests/politicas-modulos.test.ts
-- falla si este archivo y el catálogo no coinciden).
--
-- QUÉ HACE
--   A. Por cada (módulo, verbo) silencioso del catálogo, una columna booleana
--      "<llave>__<verbo>" en public.permisos_usuarios (default false) y, SOLO AL CREARLA,
--      la siembra: acción = true para quien tiene el módulo. Así nadie pierde nada el día uno.
--      Volver a correr el script no re-otorga lo que un administrador ya quitó.
--   B. Los ${PROCESOS_NUEVOS.length} procesos con clave nuevos en public.autorizacion_procesos (grupos Órdenes,
--      Inventario, Facturación, Nómina, Seguridad).
--   C. El modo de las puertas: public.autorizacion_config('politicas_acciones_modo') = 'aviso'.
--      En 'aviso', módulo sí / acción no deja rastro en autorizacion_log y pasa. Cuando el
--      log lleve días en cero: update … set valor = 'bloquear'. Sin desplegar.
--   D. Perfiles: cada perfil que enciende un módulo enciende también sus acciones, y cada
--      perfil que enciende el módulo de un proceso nuevo recibe ese proceso. Quien hoy hace
--      la acción sin clave (porque tiene el módulo) no debe quedar sin poder hacerla.
--   E. notify pgrst: PostgREST recarga el esquema para ver las columnas nuevas.
--
-- Columnas: ${pares.length} (sobre ${llaves.length} llaves de módulo). Verificación: scripts/263_verificar_262_permisos_acciones.sql.
-- Reversa: no hace falta borrar columnas; con modo 'aviso' las puertas no bloquean. Si hubiera
-- que quitarlas: alter table public.permisos_usuarios drop column "<llave>__<verbo>".

begin;

-- ── A. Columnas de acción + siembra (solo al crear) ──
do $$
declare
  r record;
  creadas int := 0;
  sin_modulo int := 0;
begin
  for r in
    select * from (values
${valores}
    ) as v(llave, accion)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'permisos_usuarios' and column_name = r.accion
    ) then
      continue;
    end if;
    execute format('alter table public.permisos_usuarios add column %I boolean not null default false', r.accion);
    creadas := creadas + 1;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'permisos_usuarios' and column_name = r.llave
    ) then
      execute format('update public.permisos_usuarios set %I = true where %I is true', r.accion, r.llave);
    else
      sin_modulo := sin_modulo + 1;
      raise warning 'la llave de módulo % no existe como columna: % se creó sin sembrar', r.llave, r.accion;
    end if;
  end loop;
  raise notice 'columnas de acción creadas y sembradas: % (sin módulo: %)', creadas, sin_modulo;
end $$;

-- ── B. Procesos con clave nuevos ──
insert into public.autorizacion_procesos (codigo, nombre, descripcion, grupo, orden, con_alcance) values
${procesos}
on conflict (codigo) do update
  set nombre = excluded.nombre,
      descripcion = excluded.descripcion,
      grupo = excluded.grupo,
      orden = excluded.orden,
      con_alcance = excluded.con_alcance;

-- ── C. Modo de las puertas: nace en 'aviso' ──
insert into public.autorizacion_config (clave, valor)
values ('politicas_acciones_modo', 'aviso')
on conflict (clave) do nothing;

-- ── D. Perfiles: acciones de los módulos que ya encienden, y procesos nuevos ──
do $$
declare
  r record;
  filas int;
  n_acc int := 0;
  n_pro int := 0;
begin
  for r in
    select * from (values
${valores}
    ) as v(llave, accion)
  loop
    insert into public.acceso_perfil_permisos (perfil_id, permiso)
    select p.perfil_id, r.accion
    from public.acceso_perfil_permisos p
    where p.permiso = r.llave
      and not exists (select 1 from public.acceso_perfil_permisos q where q.perfil_id = p.perfil_id and q.permiso = r.accion);
    get diagnostics filas = row_count;
    n_acc := n_acc + filas;
  end loop;

  for r in
    select * from (values
${procesoLlaves}
    ) as v(proceso, llave)
  loop
    insert into public.autorizacion_perfil_procesos (perfil_id, proceso)
    select p.perfil_id, r.proceso
    from public.acceso_perfil_permisos p
    where p.permiso = r.llave
      and not exists (select 1 from public.autorizacion_perfil_procesos q where q.perfil_id = p.perfil_id and q.proceso = r.proceso);
    get diagnostics filas = row_count;
    n_pro := n_pro + filas;
  end loop;
  raise notice 'perfiles: acciones agregadas %, procesos agregados %', n_acc, n_pro;
end $$;

-- ── E. Que PostgREST vea las columnas nuevas ──
notify pgrst, 'reload schema';

commit;

-- ── Verificación rápida (solo lecturas) ──
select count(*) as columnas_de_accion
from information_schema.columns
where table_schema = 'public' and table_name = 'permisos_usuarios' and column_name like '%\\_\\_%';

select grupo, count(*) as procesos
from public.autorizacion_procesos
where grupo in ('Órdenes', 'Inventario', 'Facturación', 'Nómina', 'Seguridad')
group by grupo order by grupo;

select clave, valor from public.autorizacion_config where clave = 'politicas_acciones_modo';
`
}

/** Las columnas que el 262 crea, para la prueba y el 263. */
export function columnas262(): string[] {
  return clavesDeAcciones()
}
