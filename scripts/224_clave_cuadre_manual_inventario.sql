
-- 224 · Clave personal para el CUADRE MANUAL de la conciliación pedidos vs salidas.
--
-- Gerencia 2026-10-04: "esa acción sí debería estar con clave, la mía, solo esa acción, no toda
-- la pantalla". Se refiere a Panel de Inventario › Conciliación pedidos vs salidas › botón
-- "Auditar orden" › modo edición › Guardar.
--
-- Qué hace esa acción: cambia a mano `unidades` / `unidadescargadas` de las líneas de pedido.
-- NO toca el inventario físico (invtrans), pero sí reescribe el lado contra el que se mide la
-- exactitud: con eso una diferencia puede DESAPARECER del control sin que nada haya cambiado en
-- la bodega. Por eso queda detrás de clave y con registro de quién autorizó.
--
-- Solo la Gerencia General de LIPgo (no la gerencia del proyecto, no el coordinador).
-- Aditivo e idempotente. No toca datos.

insert into public.autorizacion_procesos (codigo, nombre, descripcion, grupo, orden, con_alcance) values
  ('inv_cuadre_manual',
   'Cuadre manual de pedido vs salida',
   'En Panel de Inventario › Conciliación pedidos vs salidas › Auditar orden: cambiar a mano las unidades pedidas/cargadas de una línea de pedido. No modifica el inventario físico, pero sí el lado del pedido contra el que se mide la exactitud.',
   'Inventario', 46, true)
on conflict (codigo) do update set
  nombre = excluded.nombre, descripcion = excluded.descripcion, grupo = excluded.grupo,
  orden = excluded.orden, con_alcance = excluded.con_alcance;

insert into public.autorizacion_perfil_procesos (perfil_id, proceso)
select p.id, 'inv_cuadre_manual'
from public.autorizacion_perfiles p
where p.nombre = 'Gerencia General LIPgo'
on conflict do nothing;

-- Comprobación (visible en el editor SQL)
select pr.codigo, pr.nombre, pr.grupo, coalesce(string_agg(pf.nombre, ', '), '(ningún perfil)') as perfiles_que_lo_pueden_usar
from public.autorizacion_procesos pr
left join public.autorizacion_perfil_procesos pp on pp.proceso = pr.codigo
left join public.autorizacion_perfiles pf on pf.id = pp.perfil_id
where pr.codigo = 'inv_cuadre_manual'
group by pr.codigo, pr.nombre, pr.grupo;
