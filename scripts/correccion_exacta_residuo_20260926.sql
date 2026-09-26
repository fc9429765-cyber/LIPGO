-- Correccion 2026-09-26: ajuste fino de la correccion anterior
-- (correccion_detalle_ordenes_bascula_20260926.sql). Al repartir el
-- faltante proporcionalmente entre varias lineas y redondear cada una a 3
-- decimales por separado, la SUMA quedaba a 1kg del peso real de bascula
-- (residuo matematico del redondeo independiente). Se corrige dejando que
-- la ULTIMA linea de cada orden absorba el residuo exacto, para que la
-- suma coincida al gramo con el peso de bascula:
--   MOL202609159166: 10.328 -> 10.327
--   MOL202609169225: 4.648  -> 4.649
--   MOL202609179265: 16.293 -> 16.294

update detalleoc set toneladas = 6.242 where id = 22717; -- MOL202609159166
update detalleoc set toneladas = 0.685 where id = 22892; -- MOL202609169225
update detalleoc set toneladas = 6.242 where id = 23059; -- MOL202609179265

-- Verificacion
select numeroorden, sum(toneladas) as suma from detalleoc where numeroorden in ('MOL202609159166','MOL202609169225','MOL202609179265') group by numeroorden;
