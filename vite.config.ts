import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    host: process.env.TAURI_DEV_HOST || false,
    port: 25174,
    strictPort: true,
    hmr: process.env.TAURI_DEV_HOST
      ? {
          protocol: "ws",
          host: process.env.TAURI_DEV_HOST,
          port: 25174
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"]
    }
  }
});
