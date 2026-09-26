// setInterval que NO corre mientras la pestaña está oculta (document.hidden) y
// se ejecuta de inmediato al volver a ser visible. Las insignias de la barra
// superior y algunos paneles refrescan cada 30-120 s; con varias pestañas
// abiertas en segundo plano eso eran cientos de requests/hora sin nadie mirando.
export function setVisibleInterval(fn: () => void, ms: number): () => void {
  if (typeof window === "undefined") return () => {}
  let pendiente = false
  const tick = () => {
    if (document.visibilityState === "hidden") {
      pendiente = true
      return
    }
    fn()
  }
  const onVisible = () => {
    if (document.visibilityState === "visible" && pendiente) {
      pendiente = false
      fn()
    }
  }
  const id = setInterval(tick, ms)
  document.addEventListener("visibilitychange", onVisible)
  return () => {
    clearInterval(id)
    document.removeEventListener("visibilitychange", onVisible)
  }
}
