import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.VITE_BASE_PATH || "./";

function localCatalogApi() {
  const seedPath = new URL("./public/data/seed-catalog.json", import.meta.url);
  return {
    name: "local-catalog-api",
    configureServer(server) {
      server.middlewares.use("/api/conferences", (_request, response) => {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(readFileSync(seedPath, "utf8"));
      });
    },
  };
}

export default defineConfig({
  base,
  plugins: [localCatalogApi(), {
    name: "relative-pwa-manifest",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html.replace(/(<link rel="manifest" href=")[^"]+("[^>]*>)/, '$1./manifest.webmanifest$2');
      },
    },
  }],
  server: {
    host: process.env.VITE_HOST || "0.0.0.0",
    allowedHosts: ["terminal.local"],
  },
  build: {
    target: "es2020",
    sourcemap: true,
    rollupOptions: {
      input: {
        movies: resolve(process.cwd(), "index.html"),
        series: resolve(process.cwd(), "series.html"),
        settings: resolve(process.cwd(), "settings.html"),
      },
    },
  },
});
