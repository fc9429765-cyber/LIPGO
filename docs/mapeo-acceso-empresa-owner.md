# Mapeo de acceso: EMPRESA vs OWNER (LIPgo)

Referencia de qué controla cada tipo de acceso que se administra en
**Configuración → Gestión de Usuarios → pestaña Accesos**
(`components/configuration/user-permissions-management.tsx`) y, como plantillas, en
**Configuración → Perfiles de acceso** (`components/configuration/perfiles-acceso.tsx`, ver §4), para
que al asignar permisos se entienda su impacto real. Son **dos mecanismos
independientes** que se combinan.

---

## 1. Acceso por EMPRESA — el permiso "maestro"
**Tabla:** `perfil_acceso_empresas` (`profile_id` → `empresa_id`). Define **qué
empresas aparecen en el selector global** de la app (`/api/accessible-empresas`).

**Qué afecta:** prácticamente **TODO el sistema**. El selector fija `selectedEmpresaId`
y cada módulo filtra sus datos por la columna de empresa de su tabla/vista
(`idempresa` / `id_empresa` / `empresaid`, y `proyecto_id` en SIG). Si un usuario no
tiene una empresa, esa empresa no existe para él en ningún módulo.

| Grupo | Filtra por | Ejemplos de tablas/vistas |
|---|---|---|
| Recepción y Despacho | `idempresa` / `id_empresa` | citasvehiculos, registrosanitario, báscula, cabeceraoc |
| Gestión de Pedidos | `id_empresa` (+ owner, ver §2) | pedidoscabecera, pedidosdetalle, productos |
| Almacenamiento (inventarios) | `idempresa` / `id_empresa` | invglobal, invtrans, saldoinvdetalle, almacenes, locations, bodegas, traslados |
| Producción | `idempresa` | entradas/salidasproduccion, tolva, reprocesos, paros_produccion, aprobaciones |
| Torre de Control (integral) | `idempresa` | dashboard gerencia (citas, cabeceraoc, saldos, picking) |
| Operación LIP | `idempresa` / `proyecto_id` | picking, packing, asistencia, turnos, facturación, calificación conductor (`proyecto_id`) |
| Gestión Financiera | `idempresa` / `empresaid` (+ owner en reportes) | facturacion, facturacionturnos, tarifas*, gastos, estado de resultados |
| Gestión Humana (rrhh) | `idempresa` | headcount, hojas de vida, entrevistas, antecedentes, contratos, nómina, ausentismos |
| SST | `idempresa` (incluye 100 = Administrativo) | sst_incidentes, sst_ipevr, sst_medevac, exámenes médicos, preoperacional |
| SIG / Certificaciones | `idempresa=100` (transversal) y `proyecto_id`/`idempresa ∈ [1..4]` (por sitio) | sig_documento_cobertura, sig_indicadores (BSC), sig_satisfaccion, sig_no_conformidades |
| MRP | `idempresa` | materiales, mptrans, mrpexplosion, proveedores |
| Configuración | `id_empresa`/`idempresa`; catálogos **globales** sin filtro | clientes, productos, vendedores, bodegas, locations; (categorías, transportes, etc. globales) |

> La columna de empresa por tabla está mapeada en
> [`lib/company-constants.ts`](../lib/company-constants.ts) (`EMPRESA_ID_FIELDS`);
> las tablas de catálogo global están en `EXCLUDED_TABLES`.

### Scope SIG (empresa 100 + sitios)
- **`SIG_EMPRESA_LIP = 100`** — lo transversal del SIG (cobertura documental, matriz,
  objetivos, NC) se guarda/filtra con `idempresa = 100`.
- **`SIG_CLIENTES_LIP = [1,2,3,4]`** (Indupan, Avimol, Cedi Funza, Cedi Medellín) — el
  desglose por sitio usa `proyecto_id`/`idempresa ∈ [1..4]`.

---

## 2. Acceso por OWNER — filtro adicional de PEDIDOS
**Tabla:** `perfil_acceso_owners` (`profile_id` → `owner`, el **nombre** de la razón
social de facturación). Es un filtro **adicional e independiente** del selector de
empresa.

**Qué afecta (solo esto):**
- **Gestión de Pedidos** y **Dashboard de Pedidos**: los pedidos se filtran por
  `pedidoscabecera.empresafactura ∈ (owners del usuario)`
  (`lib/orders-actions.tsx:160,195`; `lib/dashboard-pedidos-actions.ts:152`).
- **Regla:** solo restringe **si el usuario tiene owners asignados**. Sin owners
  asignados → no hay restricción por owner (ve todos, sujeto al filtro de empresa).
- **No** participa en el selector global de empresa ni en el resto de módulos.

**Owner ↔ empresas (agrupador comercial/facturación):**

| Owner | Empresas (`id`) |
|---|---|
| **INDUPAN** | 1, 6 |
| **AVIMOL** | 2 |
| **Molinos del Atlántico** | 3, 4 |

> En la vista `facturacion`, `owner` se deriva de `productos.id_empresa` (no de
> `cabeceraoc.idempresa`); por eso la vista expone `idempresa` (sitio) **y** `owner`
> (agrupador) como columnas separadas. En **Facturación Proyectos** `owner` se usa
> como **dimensión de reporte/filtro**, no como control de seguridad.

---

## 3. Cómo se combinan
Un mismo pedido puede quedar filtrado por **dos vías a la vez**:
1. por su `id_empresa` (según el **selector de empresa** del usuario), y
2. por su `empresafactura`/**owner** (según los owners asignados al usuario).

Por eso, para que alguien vea correctamente los pedidos de una razón social, suele
necesitar **ambos**: acceso a la(s) empresa(s) del sitio **y** al owner de facturación.
El acceso por **empresa** es el permiso amplio (todo el sistema); el de **owner** es un
recorte fino, exclusivo de Pedidos/facturación.

---

## 4. Perfiles (2026-10-07; unificados el mismo día con los de autorizaciones)
**Tablas:** `autorizacion_perfiles` (EL perfil: el puesto) + `acceso_perfil_empresas` /
`_owners` / `_permisos` (qué abre) + `autorizacion_perfil_procesos` (qué autoriza con clave),
`autorizacion_usuario_perfiles` (quién lo tiene, con alcance) y `acceso_perfil_materializado`
(qué filas puso cada perfil en cada usuario). Scripts `247` (nació aparte) y `252` (se fundió
con autorizaciones: `acceso_perfiles` ya no existe).

Un **perfil** es el puesto: **empresas + owners + permisos de módulo + procesos autorizables**
("Coordinador Indupan"). Un usuario puede tener varios; su acceso es la **unión** de los
activos. Todo vive en la pantalla única *Autorizaciones* (Configuración → Seguridad y accesos):
pestaña *Perfiles* para el puesto, *Usuarios* para asignarlo a cada persona, *Claves* para la
clave personal. **El alcance de la clave sigue a las empresas del perfil** cuando este las
define (una fila de asignación por empresa); un perfil sin empresas se asigna como antes, con
el alcance que diga la administración, para no ampliar nada por accidente.

**No cambia la semántica de §1 ni §2.** Los módulos siguen leyendo `perfil_acceso_empresas`,
`perfil_acceso_owners` y `permisos_usuarios`. El perfil es la fuente: al asignarlo o editarlo,
`recalcularAccesoUsuario` (`lib/acceso-perfiles-actions.ts`) escribe el acceso efectivo en esas
tres tablas. `acceso_perfil_materializado` recuerda qué filas vinieron de perfiles, así que al
quitar un perfil se retira **solo lo que trajo**; lo marcado a mano se conserva.

> Nombres: `perfil_acceso_*` (singular, viejo) = acceso POR USUARIO; `acceso_perfil*` (nuevo)
> = el PERFIL como plantilla.
