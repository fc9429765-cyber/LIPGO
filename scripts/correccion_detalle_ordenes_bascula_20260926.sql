-- Correccion 2026-09-26: se cargo menos producto del que decia la orden original
-- en estas 3 ordenes del ID3 (error de carga, ya verificado y corregido en
-- cabeceraoc.pesovascula por el coordinador). Se prorratea detalleoc.toneladas
-- de cada linea para que la suma coincida con el peso real de bascula:
--   MOL202609159166: 10.339 -> 10.327
--   MOL202609169225: 4.6735 -> 4.649
--   MOL202609179265: 16.318 -> 16.294
-- No es un cambio de logica del sistema (Cargue en CEDIS sigue sin
-- prorratear en vivo, eso es correcto): es la correccion puntual del error
-- de carga en el detalle de estas 3 ordenes especificas.

update detalleoc set toneladas = 0.12 where id = 22707;
update detalleoc set toneladas = 0.12 where id = 22708;
update detalleoc set toneladas = 0.599 where id = 22709;
update detalleoc set toneladas = 0.599 where id = 22710;
update detalleoc set toneladas = 0.18 where id = 22711;
update detalleoc set toneladas = 0.042 where id = 22712;
update detalleoc set toneladas = 0.24 where id = 22713;
update detalleoc set toneladas = 0.599 where id = 22714;
update detalleoc set toneladas = 1.199 where id = 22715;
update detalleoc set toneladas = 0.012 where id = 22716;
update detalleoc set toneladas = 6.243 where id = 22717;
update detalleoc set toneladas = 0.25 where id = 22718;
update detalleoc set toneladas = 0.125 where id = 22719;
update detalleoc set toneladas = 0.806 where id = 22883;
update detalleoc set toneladas = 0.895 where id = 22884;
update detalleoc set toneladas = 0.358 where id = 22885;
update detalleoc set toneladas = 0.095 where id = 22886;
update detalleoc set toneladas = 0.358 where id = 22887;
update detalleoc set toneladas = 0.239 where id = 22888;
update detalleoc set toneladas = 0.716 where id = 22889;
update detalleoc set toneladas = 0.199 where id = 22890;
update detalleoc set toneladas = 0.298 where id = 22891;
update detalleoc set toneladas = 0.684 where id = 22892;
update detalleoc set toneladas = 1.198 where id = 23051;
update detalleoc set toneladas = 0.599 where id = 23052;
update detalleoc set toneladas = 0.467 where id = 23053;
update detalleoc set toneladas = 1.198 where id = 23054;
update detalleoc set toneladas = 0.599 where id = 23055;
update detalleoc set toneladas = 0.599 where id = 23056;
update detalleoc set toneladas = 0.599 where id = 23057;
update detalleoc set toneladas = 4.793 where id = 23058;
update detalleoc set toneladas = 6.241 where id = 23059;

-- Verificacion
select numeroorden, sum(toneladas) as suma from detalleoc where numeroorden in ('MOL202609159166','MOL202609169225','MOL202609179265') group by numeroorden;
