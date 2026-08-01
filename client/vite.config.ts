import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The client talks to the Socket.IO server on :3001.
// In dev we proxy /socket.io so the browser can use a same-origin URL,
// and we expose the dev server on the LAN so phones can join.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on 0.0.0.0 so phones on the same Wi-Fi can connect
    proxy: {
      "/socket.io": {
        target: "http://localhost:3001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2020",
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Split rarely-changing vendor code so it caches independently.
        // Vite 8 bundles with Rolldown, which dropped the object form of
        // manualChunks; groups match module paths instead of package entry
        // points, so each pattern has to name the transitive runtime too
        // (scheduler for react, the engine.io layer for socket.io-client).
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: "socket",
              test: /[\\/]node_modules[\\/](socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
