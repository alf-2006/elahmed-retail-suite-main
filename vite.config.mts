import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import electron from "vite-plugin-electron/simple";



export default defineConfig(({ mode }) => ({
  base: mode === "electron" ? "./" : "/",
  server: {
    host: "::",
    port: 8081,
    hmr: {
      overlay: false,
    },
  },
  build: {
    minify: "terser",
    terserOptions: {
      compress: { passes: 3, drop_console: true, drop_debugger: true, pure_funcs: ["console.log", "console.warn", "console.info"] },
      mangle: { toplevel: true, eval: true },
      format: { comments: false },
    },
  },
  plugins: [

    react(),
    mode === "development" && componentTagger(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: ["electron", "better-sqlite3", "fs", "path", "url"],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, "electron/preload.ts"),
        vite: {
          build: {
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      renderer: {},
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    entries: ["src/**/*.{ts,tsx}"],
    exclude: ["resources_extracted"],
  },
}));
