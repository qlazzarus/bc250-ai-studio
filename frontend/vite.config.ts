import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const target = env.VITE_STUDIO_TARGET || "http://127.0.0.1:18090";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target, changeOrigin: true },
      },
    },
  };
});
