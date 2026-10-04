"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ArrowUp, Bot, Building2, Sparkles, User2, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/components/auth-provider"

/**
 * Asistente IA - Chat a pantalla completa.
 *
 * Diseno minimalista: header sutil, area de mensajes scrollable centrada
 * (max-w para legibilidad) y barra de entrada fija al fondo. Usa el hook
 * `useChat` de AI SDK 6:
 *
 *  - `messages` son `UIMessage` con array de `parts` (no .content).
 *  - `sendMessage({ text })` en vez del antiguo `append`.
 *  - `status`: 'ready' | 'submitted' | 'streaming' | 'error'.
 *  - El input es estado local (no managed en v5/v6).
 */
export default function AsistenteIA({
  onNavigate,
  onOpenGroup,
}: { onNavigate?: (modulo: string) => void; onOpenGroup?: (key: string) => void } = {}) {
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const navegadosRef = useRef<Set<string>>(new Set())

  // Empresa activa global del CRM (proviene de la TopBar via auth-provider).
  // El asistente NO tiene su propio selector: respeta el contexto que el
  // usuario eligio en cualquier otro lugar del sistema. Si el usuario lo
  // cambia desde la TopBar, el siguiente mensaje sale con el id nuevo.
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()

  // Mantenemos un ref con el idEmpresa actual porque
  // `prepareSendMessagesRequest` se captura solo una vez y haria stale el
  // valor si lo leyeramos directo del closure. El ref siempre es fresco.
  const idEmpresaRef = useRef<number | null>(selectedEmpresaId ?? null)
  useEffect(() => {
    idEmpresaRef.current = selectedEmpresaId ?? null
  }, [selectedEmpresaId])

  // Equivalente AI SDK 6 a `useChat({ body: { idEmpresa } })`: usamos
  // `DefaultChatTransport` con `prepareSendMessagesRequest` para inyectar
  // el `idEmpresa` actual (proveniente del contexto global) en el body
  // de cada peticion al backend.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, id }) => ({
          body: {
            id,
            messages,
            idEmpresa: idEmpresaRef.current,
          },
        }),
      }),
    [],
  )

  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
  })

  const isThinking = status === "submitted" || status === "streaming"

  // Auto-scroll al fondo cuando llegan nuevos mensajes / chunks de streaming
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [messages, isThinking])

  // Navegación: si la IA usó 'abrir_modulo' y el backend autorizó, abrimos ese
  // módulo (una sola vez por toolCallId).
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant" || !m.parts) continue
      for (const p of m.parts as any[]) {
        if (p?.state !== "output-available" || !p?.output?.permitido || navegadosRef.current.has(p.toolCallId)) continue
        if (p?.type === "tool-abrir_submodulo" && p.output.navegar_a) {
          navegadosRef.current.add(p.toolCallId)
          onNavigate?.(p.output.navegar_a as string)
        } else if (p?.type === "tool-abrir_modulo" && p.output.navegar_grupo) {
          navegadosRef.current.add(p.toolCallId)
          onOpenGroup?.(p.output.navegar_grupo as string)
        }
      }
    }
  }, [messages, onNavigate, onOpenGroup])

  // Auto-grow del textarea (max 6 lineas aprox.)
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`
  }, [input])

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || isThinking) return
    // No bloqueamos por empresa: si el estado del cliente aún no cargó, el
    // backend resuelve la empresa activa desde el cookie. Enviar siempre.
    sendMessage({ text })
    setInput("")
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envia, Shift+Enter inserta salto de linea
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    // Llena el alto disponible del padre. El padre decide el "alto real":
    // - Standalone (`/asistente-ia`): el wrapper es `h-dvh`.
    // - Embebido en el shell del CRM: usamos un wrapper con altura
    //   `calc(100dvh - 8rem)` desde main-content para descontar la TopBar.
    <div className="flex h-full w-full flex-col bg-background overflow-hidden">
      {/* Header: branding + chip de empresa activa (solo lectura) */}
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold leading-tight text-foreground">
              LIPbot
            </h1>
            <p className="text-xs text-muted-foreground leading-tight">
              {isThinking ? "Pensando..." : "Listo para ayudarte"}
            </p>
          </div>

          {/*
            Chip informativo de la empresa activa. NO es un control: refleja
            la empresa seleccionada en la TopBar global del CRM. Si el
            usuario quiere cambiarla, lo hace desde alli y el chip se
            actualiza automaticamente.
          */}
          {selectedEmpresaId != null && (
            <div
              className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs"
              title="Empresa activa (cambia desde la barra superior)"
            >
              <Building2
                className="h-3.5 w-3.5 text-primary shrink-0"
                aria-hidden="true"
              />
              <span className="font-semibold text-primary tabular-nums">
                #{selectedEmpresaId}
              </span>
              {selectedEmpresaNombre && (
                <>
                  <span className="text-primary/40">|</span>
                  <span className="max-w-[140px] truncate font-medium text-foreground/80">
                    {selectedEmpresaNombre}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Mensajes */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {messages.length === 0 ? (
            <EmptyState onSuggest={(text) => sendMessage({ text })} />
          ) : (
            <ul className="flex flex-col gap-6">
              {messages.map((m) => (
                <li key={m.id}>
                  <MessageBubble message={m} />
                </li>
              ))}

              {/* Indicador de "pensando" cuando aun no llega texto */}
              {status === "submitted" && <TypingIndicator />}
            </ul>
          )}

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Ocurrio un error: {error.message}
            </div>
          )}
        </div>
      </div>

      {/* Composer fijo al fondo */}
      <div className="sticky bottom-0 z-10 border-t border-border/60 bg-background/80 backdrop-blur-md">
        <form
          onSubmit={handleSubmit}
          className="mx-auto w-full max-w-3xl px-4 py-3"
        >
          <div
            className={cn(
              "relative flex items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm",
              "focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15",
              "transition-colors",
            )}
          >
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Escribe tu mensaje..."
              disabled={status === "error"}
              className={cn(
                "min-h-0 resize-none border-0 bg-transparent p-1 text-sm leading-6 shadow-none",
                "focus-visible:ring-0 focus-visible:ring-offset-0",
                "placeholder:text-muted-foreground",
              )}
            />

            {isThinking ? (
              <Button
                type="button"
                size="icon"
                variant="default"
                onClick={() => stop()}
                aria-label="Detener generacion"
                className="h-9 w-9 shrink-0 rounded-full"
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim()}
                aria-label="Enviar mensaje"
                className="h-9 w-9 shrink-0 rounded-full"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>

          <p className="mt-2 px-1 text-[11px] text-muted-foreground">
            {selectedEmpresaId == null ? (
              <span className="text-amber-700">
                Selecciona una empresa en la barra superior para comenzar.
              </span>
            ) : (
              "Pulsa Enter para enviar, Shift + Enter para salto de linea."
            )}
          </p>
        </form>
      </div>
    </div>
  )
}

/* ----------------------------- Sub componentes ----------------------------- */

/**
 * Burbuja de mensaje. Diferencia visual:
 *  - usuario   -> alineada a la derecha, fondo `primary`, sin avatar.
 *  - asistente -> alineada a la izquierda, fondo neutro, con avatar Bot.
 */
function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user"
  const text = getMessageText(message)

  return (
    <div
      className={cn(
        "flex w-full gap-3",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted text-foreground rounded-bl-md",
        )}
      >
        {text || (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
          </span>
        )}
      </div>

      {isUser && (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <User2 className="h-4 w-4" />
        </div>
      )}
    </div>
  )
}

/**
 * Indicador cuando el modelo aun no ha emitido el primer chunk.
 */
function TypingIndicator() {
  return (
    <li className="flex items-center gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bot className="h-4 w-4" />
      </div>
      <div className="rounded-2xl rounded-bl-md bg-muted px-4 py-3">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:240ms]" />
        </span>
      </div>
    </li>
  )
}

/**
 * Estado vacio con sugerencias rapidas.
 */
function EmptyState({ onSuggest }: { onSuggest: (text: string) => void }) {
  // Sugerencias alineadas a las 5 tablas que el asistente puede consultar
  // (pedidoscabecera, pedidosdetalle, cabeceraoc, detalleoc, saldoinvdetalle).
  // Cada una toca una tabla distinta para que el usuario descubra el
  // alcance del asistente en un click.
  const suggestions = [
    "Cuantos pedidos se hicieron este mes?",
    "Que ordenes de cargue estan pendientes hoy?",
    "Muestrame el stock disponible de los productos",
    "Que productos lleva la orden de cargue mas reciente?",
  ]

  return (
    <div className="flex flex-col items-center justify-center pt-12 pb-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-5 w-5" />
      </div>
      <h2 className="text-balance text-xl font-semibold tracking-tight text-foreground">
        Como te puedo ayudar hoy?
      </h2>
      <p className="mt-1 max-w-md text-pretty text-sm text-muted-foreground">
        Pregunta lo que necesites. Las respuestas son generadas por IA y pueden
        contener errores.
      </p>

      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggest(s)}
            className={cn(
              "lg-card px-4 py-3 text-left text-sm text-foreground/90",
              "transition-colors hover:bg-muted hover:border-border/80",
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

/* --------------------------------- Helpers -------------------------------- */

/**
 * Extrae el texto plano de un `UIMessage` recorriendo las `parts`.
 * En AI SDK 6 NO existe `message.content`; el contenido se acumula en
 * `parts: [{ type: 'text', text }, ...]`.
 */
function getMessageText(message: UIMessage): string {
  if (!message.parts || !Array.isArray(message.parts)) return ""
  return message.parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text" && typeof (p as any).text === "string",
    )
    .map((p) => p.text)
    .join("")
}
