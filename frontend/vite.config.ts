import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8010",
      "/ws": {
        target: "ws://127.0.0.1:8010",
        ws: true,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
});
