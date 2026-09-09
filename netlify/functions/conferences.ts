import type { Config, Context } from "@netlify/functions";
import {
  fallbackCatalog,
  isCatalogStale,
  readLegacyCatalog,
  readStoredCatalog,
  refreshCatalog,
} from "./_shared/catalog-store";
import type { CatalogPayload } from "./_shared/types";

const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: RESPONSE_HEADERS,
  });
}

export default async (request: Request, context: Context) => {
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const deployContext = context.deploy?.context || "dev";
  const apiKey = Netlify.env.get("YOUTUBE_API_KEY")?.trim();
  const stored = await readStoredCatalog(deployContext);
  const legacy = stored?.videos?.length ? null : await readLegacyCatalog(deployContext);
  let catalog: CatalogPayload | null = stored || legacy;

  if (apiKey && isCatalogStale(stored, 6 * 3600_000)) {
    try {
      catalog = await refreshCatalog(apiKey, deployContext);
    } catch (error) {
      console.error("Catalog refresh failed", error instanceof Error ? error.message : "unknown");
    }
  }

  if (!catalog?.videos?.length) {
    catalog = {
      ...fallbackCatalog,
      generatedAt: new Date().toISOString(),
      notice: apiKey
        ? "Catalogue de secours actif pendant la prochaine collecte."
        : "Catalogue vérifié actif. La collecte étendue démarrera avec la clé YouTube serveur.",
    };
  }

  return json(catalog);
};

export const config: Config = {
  path: "/api/conferences",
};
