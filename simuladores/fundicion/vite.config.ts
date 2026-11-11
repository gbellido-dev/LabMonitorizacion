import vinext from "vinext";
import { defineConfig } from "vite";

// Gemelo digital de la Fundición: vinext (App Router de Next.js sobre Vite) con el entorno de
// ejecución de Cloudflare (workerd), que es el que usa `npm run start` para servir el build.
const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
};

export default defineConfig(async () => {
  // El estado de Wrangler y Miniflare se queda dentro del proyecto.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler toma la ruta de sus registros al importar el plugin de Cloudflare.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
