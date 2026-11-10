import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, proxy: { "/api": "http://localhost:8020", "/ws": { target: "ws://localhost:8020", ws: true } } },
  build: { target: "es2022" },
});

