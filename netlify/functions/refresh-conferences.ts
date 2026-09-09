import type { Config, Context } from "@netlify/functions";
import { refreshCatalog } from "./_shared/catalog-store";

export default async (_request: Request, context: Context) => {
  const apiKey = Netlify.env.get("YOUTUBE_API_KEY")?.trim();
  if (!apiKey) {
    console.log("Scheduled discovery skipped: YOUTUBE_API_KEY is not configured.");
    return;
  }

  try {
    const catalog = await refreshCatalog(apiKey, context.deploy?.context || "production");
    console.log(`Scheduled discovery stored ${catalog.videos.length} embeddable movies.`);
  } catch (error) {
    console.error("Scheduled discovery failed", error instanceof Error ? error.message : "unknown");
    throw error;
  }
};

export const config: Config = {
  schedule: "15 */6 * * *",
};
