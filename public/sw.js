// Service worker minimo de LIPgo (v2, 2026-10-02).
//
// Su unico proposito es habilitar la instalacion de la PWA: los navegadores
// exigen un SW con manejador de `fetch` para ofrecer "Instalar". NO cachea
// nada, para no servir paginas ni datos obsoletos.
//
// Incidente 2026-10-02 ("This page couldn't load" en la app instalada): la
// version anterior interceptaba TAMBIEN las navegaciones y, si la red fallaba
// un instante o la respuesta era una redireccion (lipgo.app -> www.lipgo.app),
// devolvia `Response.error()`, y el navegador mostraba su pagina de error en
// vez de reintentar o seguir la redireccion. Ahora:
//   - Las NAVEGACIONES (abrir o recargar una pantalla) no se interceptan: las
//     maneja el navegador como siempre (sigue redirecciones, reintenta, etc.).
//   - El resto de GET pasa a la red tal cual; si falla, se deja que el
//     navegador reporte el error normal, nunca un Response.error() fabricado.
// Cualquier cambio en este archivo hace que el navegador instale la version
// nueva en la siguiente visita (skipWaiting + clients.claim).
self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return
  if (event.request.mode === "navigate") return
  event.respondWith(fetch(event.request))
})
