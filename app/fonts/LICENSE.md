# Fuentes servidas localmente

Los archivos de esta carpeta se sirven desde el propio sitio en lugar de pedirlos a
Google Fonts en cada build. Motivo (2026-10-05): el build de Vercel fallaba al azar con
`next/font/google queries have exactly one entry`, un defecto intermitente de Turbopack al
restaurar la caché. Con los archivos en el repositorio el build es determinista y la página
ya no hace una ida y vuelta a Google para pintar texto.

| Archivo | Fuente | Rango de pesos | Licencia |
|---|---|---|---|
| `ibm-plex-sans-latin.woff2` | IBM Plex Sans (subconjunto latín), IBM | 400 a 700 | SIL Open Font License 1.1 |
| `geist-mono-latin.woff2` | Geist Mono (subconjunto latín), Vercel | 100 a 900 | SIL Open Font License 1.1 |

Ambas licencias permiten redistribuir los archivos con el software. Se cargan en
`app/layout.tsx` con `next/font/local`; las variables CSS siguen siendo `--font-plex` y
`--font-mono`, así que ninguna pantalla cambia.

Si hace falta otro subconjunto (p. ej. latín extendido) o otro peso, se descarga el `woff2`
correspondiente y se agrega al arreglo `src` de la fuente en `app/layout.tsx`.
