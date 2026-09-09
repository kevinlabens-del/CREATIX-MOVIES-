import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

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
        // Le manifeste public doit rester à la racine de l'app : ses chemins
        // start_url, scope et icons sont relatifs à son emplacement.
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
  },
});
