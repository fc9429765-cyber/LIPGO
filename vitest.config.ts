// Pruebas automáticas (vitest). Solo módulos PUROS (sin Supabase, sin "use server"):
// reglas de negocio que, si cambian sin querer, rompen inventario, pedidos o nómina.
// Correr: pnpm test. La integración continua (.github/workflows/ci.yml) las exige.
import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
})
