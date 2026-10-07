import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import ports from "./server/dev-ports.json";
import { assertNoDevTokenInBuild } from "./src/render/config/buildGuard";

export default defineConfig(({ command, mode }) => {
  assertNoDevTokenInBuild(command, mode, loadEnv(mode, process.cwd(), "VITE_"));
  return {
    plugins: [react(), tsconfigPaths(), tailwindcss()],
    server: {
      port: ports.vitePort,
      // The token proxy only accepts the Vite origins derived from this port.
      strictPort: true,
      // Dev token proxy (`pnpm proxy`) so VITE_API_URL can stay empty.
      // changeOrigin rewrites Host to 127.0.0.1:<proxyPort>, which the proxy requires.
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${ports.proxyPort}`,
          changeOrigin: true
        }
      }
    },
    preview: { port: ports.vitePort }
  };
});
