import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // __dirname isn't available in ESM (this config is "type": "module")
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
