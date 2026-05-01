import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // The UI always connects to the same origin's `/ws`. In dev, Vite
      // forwards that to the askdiff WS server. The `/askdiff-dev` skill
      // sets ASKDIFF_DEV_WS_TARGET to the actual chosen port.
      "/ws": {
        target: process.env["ASKDIFF_DEV_WS_TARGET"] ?? "ws://localhost:7837",
        ws: true,
        changeOrigin: false,
      },
    },
  },
});
