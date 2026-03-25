import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/pmu": {
        target: "https://online.turfinfo.api.pmu.fr",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pmu/, ""),
      },
    },
  },
});
