import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths(), tailwindcss()],
  server: {
    port: 3000,
    // Dev token proxy (`pnpm proxy`) so VITE_API_URL can stay empty.
    proxy: { "/api": "http://127.0.0.1:8787" }
  },
  preview: { port: 3000 }
});
