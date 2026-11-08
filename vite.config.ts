import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // O WASM de criptografia do matrix-js-sdk precisa ser servido como está.
  optimizeDeps: { exclude: ["@matrix-org/matrix-sdk-crypto-wasm"] },
  server: { port: 5173, strictPort: false },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
});
