import type {
  CatalogPayload,
  Conference,
  ConferenceLanguage,
  ConferenceStatus,
} from "./types";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const MIN_REPLAY_DURATION_SECONDS = 45 * 60;
const MAX_CATALOG_SIZE = 160;

export const DISCOVERY_QUERIES = [
  { query: "film complet officiel gratuit", language: "fr" },
  { query: "film complet domaine public", language: "fr" },
  { query: "film classique complet officiel", language: "fr" },
  { query: "long métrage complet chaîne officielle", language: "fr" },
  { query: "full movie official free", language: "en" },
  { query: "public domain full movie", language: "en" },
  { query: "classic movie full official", language: "en" },
  { query: "feature film full movie official", language: "en" },
  { query: "free full movie official channel", language: "en" },
  { query: "public domain horror full movie", language: "en" },
  { query: "public domain science fiction full movie", language: "en" },
  { query: "public domain comedy full movie", language: "en" },
] as const;

export const EVENT_DISCOVERY_QUERIES = [
  { query: "film complet première officielle", language: "fr" },
  { query: "official full movie premiere", language: "en" },
] as const;

type FetchLike = typeof fetch;

interface YouTubeSearchItem {
  id?: { videoId?: string };
}

interface YouTubeVideoItem {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    defaultAudioLanguage?: string;
    defaultLanguage?: string;
    liveBroadcastContent?: "live" | "upcoming" | "none";
    thumbnails?: Record<string, { url?: string }>;
  };
  status?: {
    embeddable?: boolean;
    privacyStatus?: string;
    uploadStatus?: string;
  };
  contentDetails?: {
    duration?: string;
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
  };
  liveStreamingDetails?: {
    scheduledStartTime?: string;
    actualStartTime?: string;
    actualEndTime?: string;
  };
}

interface DiscoveryOptions {
  fetchImpl?: FetchLike;
  now?: Date;
  queryOffset?: number;
  queryBatchSize?: number;
}

function fold(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function parseIsoDuration(value?: string): number | null {
  if (!value) return null;
  const match = value.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  );
  if (!match) return null;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return (
    Number(days) * 86400 +
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Math.round(Number(seconds))
  );
}

function decodeEntities(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function detectLanguage(item: YouTubeVideoItem): ConferenceLanguage {
  const declared = fold(
    item.snippet?.defaultAudioLanguage || item.snippet?.defaultLanguage || "",
  );
  if (declared.startsWith("fr")) return "fr";
  if (declared.startsWith("en")) return "en";

  const text = fold(`${item.snippet?.title || ""} ${item.snippet?.description || ""}`);
  const frenchSignals = [
    " film ",
    " film complet ",
    " long metrage ",
    " cinema ",
    " avec ",
    " comment ",
    " français ",
    " français ",
    " version française ",
  ];
  const englishSignals = [
    " movie ",
    " full movie ",
    " feature film ",
    " cinema ",
    " film ",
    " with ",
    " how ",
  ];
  const padded = ` ${text} `;
  const frScore = frenchSignals.filter((signal) => padded.includes(signal)).length;
  const enScore = englishSignals.filter((signal) => padded.includes(signal)).length;
  if (frScore > enScore) return "fr";
  if (enScore > 0) return "en";
  return "other";
}

export function classifyTopics(textValue: string, language: ConferenceLanguage) {
  const text = fold(textValue);
  const topics: string[] = [];
  const add = (topic: string, expressions: string[]) => {
    if (expressions.some((expression) => text.includes(expression))) topics.push(topic);
  };

  add("Action", ["action", "combat", "martial", "war movie", "guerre"]);
  add("Science-fiction", ["science fiction", "sci-fi", "scifi", "space", "alien", "futuriste"]);
  add("Horreur", ["horror", "horreur", "zombie", "ghost", "haunted", "vampire"]);
  add("Comédie", ["comedy", "comedie", "funny", "humour"]);
  add("Thriller", ["thriller", "suspense", "crime", "mystery", "mystere"]);
  add("Drame", ["drama", "drame", "dramatic"]);
  add("Animation", ["animation", "animated", "cartoon", "anime"]);
  add("Aventure", ["adventure", "aventure", "western", "epic"]);
  add("Classiques", ["classic", "classique", "vintage", "public domain", "domaine public"]);
  add("Documentaire", ["documentary", "documentaire", "non-fiction"]);

  if (!topics.length) topics.push("Classiques");
  if (language === "fr") topics.push("Français");
  if (language === "en") topics.push("Anglais");
  return [...new Set(topics)];
}

export function getStatus(item: YouTubeVideoItem, now = new Date()): ConferenceStatus {
  const live = item.liveStreamingDetails;
  if (live?.actualEndTime) return "replay";
  if (
    item.snippet?.liveBroadcastContent === "live" ||
    (live?.actualStartTime && !live.actualEndTime)
  ) {
    return "live";
  }
  const scheduledStart = live?.scheduledStartTime
    ? new Date(live.scheduledStartTime).getTime()
    : Number.NaN;
  if (!live?.actualStartTime && Number.isFinite(scheduledStart) && scheduledStart > now.getTime()) {
    return "upcoming";
  }
  return "replay";
}

export function scoreVideo(
  item: YouTubeVideoItem,
  durationSeconds: number | null,
  status: ConferenceStatus,
) {
  const title = fold(item.snippet?.title || "");
  const description = fold(item.snippet?.description || "");
  const channel = fold(item.snippet?.channelTitle || "");
  const combined = `${title} ${description}`;
  let score = 0;

  const movieSignals = [
    "full movie", "film complet", "feature film", "long metrage", "movie", "film",
    "cinema", "classic movie", "film classique"
  ];
  const legalSignals = [
    "public domain", "domaine public", "official", "officiel", "official channel",
    "chaine officielle", "free movie", "film gratuit", "licensed", "licence"
  ];
  const trustedChannelSignals = [
    "official", "studio", "films", "movies", "cinema", "archive", "classics"
  ];
  const negativeSignals = [
    "trailer", "bande annonce", "teaser", "clip", "excerpt", "extrait", "review",
    "critique", "reaction", "making of", "behind the scenes", "interview", "short film",
    "court metrage", "scene", "ending", "recap", "explained"
  ];

  const movieHits = movieSignals.filter((signal) => combined.includes(fold(signal))).length;
  const titleMovieHits = movieSignals.filter((signal) => title.includes(fold(signal))).length;
  const legalHits = legalSignals.filter((signal) => combined.includes(fold(signal))).length;

  score += Math.min(titleMovieHits * 18, 38);
  score += Math.min(movieHits * 7, 24);
  score += Math.min(legalHits * 18, 36);
  if (trustedChannelSignals.some((signal) => channel.includes(fold(signal)))) score += 8;
  if (status === "live") score += 12;
  if (status === "upcoming") score += 10;
  if (durationSeconds && durationSeconds >= 90 * 60) score += 18;
  else if (durationSeconds && durationSeconds >= 70 * 60) score += 14;
  else if (durationSeconds && durationSeconds >= 45 * 60) score += 8;
  if (durationSeconds && durationSeconds < MIN_REPLAY_DURATION_SECONDS) score -= 60;
  if (negativeSignals.some((signal) => combined.includes(fold(signal)))) score -= 70;
  if (!movieHits) score -= 70;
  if (!legalHits && status === "replay") score -= 35;

  return Math.max(0, Math.min(100, score));
}

export function normalizeYouTubeVideo(
  item: YouTubeVideoItem,
  now = new Date(),
): Conference | null {
  if (!item.id || !item.snippet) return null;
  const status = getStatus(item, now);
  const uploadStatus = item.status?.uploadStatus || "";
  const uploadIsPlayable =
    status === "replay"
      ? uploadStatus === "processed"
      : uploadStatus === "processed" || uploadStatus === "uploaded";
  if (
    item.status?.embeddable !== true ||
    item.status?.privacyStatus !== "public" ||
    !uploadIsPlayable
  ) {
    return null;
  }
  const regionRestriction = item.contentDetails?.regionRestriction;
  if (
    regionRestriction?.blocked?.includes("FR") ||
    (regionRestriction?.allowed?.length && !regionRestriction.allowed.includes("FR"))
  ) {
    return null;
  }

  const durationSeconds = parseIsoDuration(item.contentDetails?.duration);
  if (
    status === "replay" &&
    durationSeconds !== null &&
    durationSeconds < MIN_REPLAY_DURATION_SECONDS
  ) {
    return null;
  }

  const language = detectLanguage(item);
  const title = decodeEntities(item.snippet.title || "Film").trim();
  const description = decodeEntities(item.snippet.description || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
  const score = scoreVideo(item, durationSeconds, status);
  if (score < 32) return null;

  const thumbnail =
    item.snippet.thumbnails?.high?.url ||
    item.snippet.thumbnails?.medium?.url ||
    `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;

  return {
    id: `youtube:${item.id}`,
    source: "youtube",
    videoId: item.id,
    title,
    channel: decodeEntities(item.snippet.channelTitle || "YouTube"),
    description,
    status,
    publishedAt: item.snippet.publishedAt || now.toISOString(),
    scheduledStart: item.liveStreamingDetails?.scheduledStartTime,
    actualStart: item.liveStreamingDetails?.actualStartTime,
    actualEnd: item.liveStreamingDetails?.actualEndTime,
    durationSeconds,
    language,
    topics: classifyTopics(`${title} ${description} ${item.snippet.channelTitle || ""}`, language),
    thumbnail,
    score,
    embeddable: true,
    lastCheckedAt: now.toISOString(),
  };
}

async function youtubeRequest<T>(
  path: string,
  params: Record<string, string>,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<T> {
  const url = new URL(`${YOUTUBE_API}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("key", apiKey);
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`YouTube API request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

async function searchVideoIds(
  apiKey: string,
  query: string,
  language: string,
  fetchImpl: FetchLike,
  now: Date,
  eventType?: "live" | "upcoming",
) {
  const publishedAfter = new Date(now.getTime() - 150 * 86400_000).toISOString();
  const params: Record<string, string> = {
    part: "snippet",
    type: "video",
    maxResults: eventType ? "25" : "10",
    q: query,
    order: eventType ? "date" : "relevance",
    safeSearch: "strict",
    videoEmbeddable: "true",
    relevanceLanguage: language,
    regionCode: "FR",
  };
  if (eventType) params.eventType = eventType;
  else {
    params.publishedAfter = publishedAfter;
    params.videoDuration = "long";
  }

  const payload = await youtubeRequest<{ items?: YouTubeSearchItem[] }>(
    "search",
    params,
    apiKey,
    fetchImpl,
  );
  return (payload.items || [])
    .map((item) => item.id?.videoId)
    .filter((id): id is string => Boolean(id));
}

async function fetchVideoDetails(
  apiKey: string,
  ids: string[],
  fetchImpl: FetchLike,
) {
  const uniqueIds = [...new Set(ids)].slice(0, 250);
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += 50) {
    chunks.push(uniqueIds.slice(index, index + 50));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      youtubeRequest<{ items?: YouTubeVideoItem[] }>(
        "videos",
        {
          part: "snippet,status,contentDetails,liveStreamingDetails",
          id: chunk.join(","),
          maxResults: "50",
        },
        apiKey,
        fetchImpl,
      ),
    ),
  );
  return results.flatMap((result) => result.items || []);
}

function sortCatalog(videos: Conference[], now: Date) {
  const statusWeight: Record<ConferenceStatus, number> = {
    live: 3,
    upcoming: 2,
    replay: 1,
  };
  return [...videos].sort((a, b) => {
    const statusDifference = statusWeight[b.status] - statusWeight[a.status];
    if (statusDifference) return statusDifference;
    if (a.status === "upcoming" && b.status === "upcoming") {
      return (
        new Date(a.scheduledStart || a.publishedAt).getTime() -
        new Date(b.scheduledStart || b.publishedAt).getTime()
      );
    }
    const freshnessA = Math.max(0, 25 - (now.getTime() - new Date(a.publishedAt).getTime()) / 86400_000);
    const freshnessB = Math.max(0, 25 - (now.getTime() - new Date(b.publishedAt).getTime()) / 86400_000);
    return b.score + freshnessB - (a.score + freshnessA);
  });
}

export async function discoverYouTubeCatalog(
  apiKey: string,
  existingVideos: Conference[] = [],
  options: DiscoveryOptions = {},
): Promise<CatalogPayload> {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date();
  const batchSize = Math.max(1, Math.min(options.queryBatchSize || 6, DISCOVERY_QUERIES.length));
  const offset = Math.abs(options.queryOffset ?? Math.floor(now.getTime() / 21_600_000)) % DISCOVERY_QUERIES.length;
  const topicQueries = Array.from({ length: batchSize }, (_, index) =>
    DISCOVERY_QUERIES[(offset + index) % DISCOVERY_QUERIES.length],
  );
  const searches = [
    ...topicQueries.map((entry) =>
      searchVideoIds(apiKey, entry.query, entry.language, fetchImpl, now),
    ),
    ...EVENT_DISCOVERY_QUERIES.flatMap((entry) => [
      searchVideoIds(apiKey, entry.query, entry.language, fetchImpl, now, "live"),
      searchVideoIds(apiKey, entry.query, entry.language, fetchImpl, now, "upcoming"),
    ]),
  ];
  const searchResults = await Promise.allSettled(searches);
  const discoveredIds = searchResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  const existingIds = existingVideos
    .filter((video) => video.source === "youtube" && video.videoId)
    .map((video) => video.videoId as string);
  const ids = [...new Set([...discoveredIds, ...existingIds])];
  if (!ids.length) throw new Error("No YouTube videos could be discovered");

  const details = await fetchVideoDetails(apiKey, ids, fetchImpl);
  const normalized = details
    .map((item) => normalizeYouTubeVideo(item, now))
    .filter((video): video is Conference => Boolean(video));
  const deduplicated = [...new Map(normalized.map((video) => [video.id, video])).values()];

  return {
    version: 3,
    mode: "youtube-api",
    generatedAt: now.toISOString(),
    videos: sortCatalog(deduplicated, now).slice(0, MAX_CATALOG_SIZE),
  };
}
