import { config, clean, isFeature, topicsFor, request } from "./catalog-utils.mjs";

const SUPPORTED_PLAYERS = new Set(["mp4", "webm", "hls", "youtube", "dailymotion", "vimeo", "onf", "archive"]);

function safeHttps(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function normalizePlayback(item, source) {
  const kind = String(item.player || item.source || source.player || "").toLowerCase();
  if (!SUPPORTED_PLAYERS.has(kind)) return null;
  const playbackUrl = safeHttps(item.playbackUrl || item.url);
  const videoId = item.videoId ? String(item.videoId) : undefined;
  const identifier = item.identifier ? String(item.identifier) : undefined;

  if (["mp4", "webm", "hls", "onf"].includes(kind) && !playbackUrl) return null;
  if (["youtube", "dailymotion", "vimeo"].includes(kind) && !videoId) return null;
  if (kind === "archive" && !identifier) return null;

  return {
    source: kind,
    ...(playbackUrl ? { playbackUrl } : {}),
    ...(videoId ? { videoId } : {}),
    ...(identifier ? { identifier } : {}),
    embeddable: true,
    label: clean(item.label || source.name || source.id || "Source personnalisée"),
  };
}

function normalizeItem(item, source, now) {
  if (!item || typeof item !== "object") return null;
  const title = clean(item.title);
  const durationSeconds = Number(item.durationSeconds);
  const language = String(item.language || source.language || "").toLowerCase();
  if (!title || language !== "fr" || !isFeature(title, durationSeconds, { trustedFilmCatalog: true })) return null;

  const playback = normalizePlayback(item, source);
  if (!playback) return null;

  const sourceUrl = safeHttps(item.sourceUrl || source.homepage || source.url);
  const thumbnail = safeHttps(item.thumbnail);
  const idBase = clean(item.id || item.videoId || item.identifier || `${title}-${durationSeconds}`)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (!idBase) return null;

  return {
    id: `custom:${source.id || "feed"}:${idBase}`,
    source: playback.source,
    title,
    channel: clean(item.channel || source.name || "Source personnalisée"),
    description: clean(item.description || "").slice(0, 420),
    thumbnail,
    publishedAt: item.publishedAt || null,
    status: "replay",
    durationSeconds,
    language: "fr",
    languageLabel: "Français · source déclarée",
    languageEvidence: "custom-feed",
    topics: Array.isArray(item.topics) && item.topics.length ? item.topics.map(clean).filter(Boolean) : topicsFor(`${title} ${item.description || ""}`),
    score: Number.isFinite(Number(item.score)) ? Math.max(0, Math.min(100, Number(item.score))) : 70,
    embeddable: true,
    sourceUrl,
    rights: clean(item.rights || source.rights || "Lecture fournie par la source"),
    rightsUrl: safeHttps(item.rightsUrl || source.rightsUrl),
    attribution: clean(item.attribution || source.attribution || source.name || ""),
    lastCheckedAt: now.toISOString(),
    verification: "custom-json-feed",
    playbackSources: [playback],
  };
}

export async function discoverCustomJsonFeeds({ fetchImpl = fetch, now = new Date() } = {}) {
  const feeds = Array.isArray(config.customJsonFeeds) ? config.customJsonFeeds.filter((feed) => feed?.enabled !== false) : [];
  const videos = [];
  const reports = [];

  for (const source of feeds) {
    const id = clean(source.id || source.name || "custom");
    const url = safeHttps(source.url);
    if (!url) {
      reports.push({ id: `custom:${id}`, provider: "custom", name: source.name || id, status: "unavailable", count: 0, detail: "URL HTTPS invalide" });
      continue;
    }
    try {
      const payload = await request(url, { json: true, fetchImpl, timeout: 20000 });
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.videos) ? payload.videos : [];
      const normalized = rows.map((item) => normalizeItem(item, source, now)).filter(Boolean);
      videos.push(...normalized);
      reports.push({ id: `custom:${id}`, provider: "custom", name: source.name || id, status: "ok", count: normalized.length, discovered: rows.length, lastSuccessAt: now.toISOString() });
    } catch (error) {
      reports.push({ id: `custom:${id}`, provider: "custom", name: source.name || id, status: "unavailable", count: 0, detail: error?.message || "Erreur de collecte" });
    }
  }

  return { videos, reports, removed: [] };
}
