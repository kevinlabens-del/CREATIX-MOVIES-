export const STATUS_FILTERS = [
  { id: "all", label: "Tout le catalogue", icon: "◉" },
  { id: "live", label: "Premières", icon: "●" },
  { id: "upcoming", label: "À venir", icon: "◷" },
  { id: "replay", label: "Disponibles", icon: "▶" },
  { id: "latest", label: "Nouveautés", icon: "↗" },
  { id: "favorites", label: "Favoris", icon: "★" },
];

export const TOPIC_FILTERS = [
  "Action",
  "Science-fiction",
  "Horreur",
  "Comédie",
  "Thriller",
  "Drame",
  "Animation",
  "Aventure",
  "Classiques",
  "Documentaire",
  "Français",
  "Anglais",
];

export function normalizeSearch(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "Durée variable";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours) return `${hours} h ${String(minutes).padStart(2, "0")}`;
  return `${minutes} min`;
}

export function formatDate(value, locale = "fr-FR") {
  if (!value) return "Date non renseignée";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date à confirmer";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value, locale = "fr-FR") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Horaire à confirmer";
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${formatDate(value, locale)} · ${time}`;
}

export function formatCountdown(value, now = Date.now()) {
  const remaining = new Date(value).getTime() - now;
  if (!Number.isFinite(remaining)) return "Horaire à confirmer";
  if (remaining <= 0) return "Démarrage imminent";
  const days = Math.floor(remaining / 86400_000);
  const hours = Math.floor((remaining % 86400_000) / 3600_000);
  const minutes = Math.floor((remaining % 3600_000) / 60_000);
  if (days) return `Dans ${days} j ${hours} h`;
  if (hours) return `Dans ${hours} h ${minutes} min`;
  return `Dans ${Math.max(1, minutes)} min`;
}

export function getStatusLabel(video) {
  const status = typeof video === "string" ? video : video?.status;
  if (status === "live") return "Première";
  if (status === "upcoming") return "À venir";
  return "Disponible";
}

export function getConferenceTimingLabel(video) {
  if (video?.status === "live") {
    return video.actualStart
      ? `Depuis · ${formatDateTime(video.actualStart)}`
      : "Première en cours";
  }
  if (video?.status === "upcoming") {
    return video.scheduledStart
      ? `Prévu · ${formatDateTime(video.scheduledStart)}`
      : "Programmation à confirmer";
  }
  if (video?.actualEnd) return `Terminé · ${formatDateTime(video.actualEnd)}`;
  return `Publié · ${formatDate(video?.publishedAt)}`;
}

export function countCatalog(videos) {
  return {
    total: videos.length,
    live: videos.filter((video) => video.status === "live").length,
    upcoming: videos.filter((video) => video.status === "upcoming").length,
    replay: videos.filter((video) => video.status === "replay").length,
  };
}

function matchesDate(video, range, now) {
  if (range === "all") return true;
  if (video.status === "upcoming") return true;
  const days = Number(range);
  if (!Number.isFinite(days)) return true;
  const timestamp = new Date(video.publishedAt).getTime();
  return timestamp >= now - days * 86400_000;
}

function legacyPlaybackSource(video) {
  if (!video?.source) return null;
  return {
    source: video.source,
    videoId: video.videoId,
    playbackUrl: video.playbackUrl,
    identifier: video.identifier,
    embeddable: video.embeddable,
    label: video.sourceLabel,
  };
}

export function getPlaybackSources(video) {
  const declared = Array.isArray(video?.playbackSources) ? video.playbackSources : [];
  const legacy = legacyPlaybackSource(video);
  const sources = [...declared, ...(legacy ? [legacy] : [])];
  const seen = new Set();
  return sources.filter((item) => {
    if (!item || item.embeddable === false) return false;
    const key = `${item.source || ""}|${item.videoId || ""}|${item.playbackUrl || ""}|${item.identifier || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isPlayableSource(source) {
  if (!source || source.embeddable === false) return false;
  if (source.source === "youtube") return /^[\w-]{11}$/.test(source.videoId || "");
  if (source.source === "vimeo") return /^\d{6,12}$/.test(source.videoId || "");
  if (source.source === "dailymotion") return /^x[a-zA-Z0-9]{4,14}$/.test(source.videoId || "");
  if (source.source === "onf") {
    try {
      const url = new URL(source.playbackUrl);
      return url.protocol === "https:" && url.hostname === "www.onf.ca" && !url.username && !url.password && /^\/film\/[\w-]+\/embed\/player\/$/.test(url.pathname);
    } catch { return false; }
  }
  if (source.source === "archive") return /^[A-Za-z0-9._-]{2,160}$/.test(source.identifier || "");
  if (["mp4", "webm", "hls"].includes(source.source)) {
    try {
      const url = new URL(source.playbackUrl);
      if (url.protocol !== "https:") return false;
      const expectedExtension = {
        mp4: /\.mp4$/i,
        webm: /\.webm$/i,
        hls: /\.m3u8$/i,
      }[source.source];
      return expectedExtension.test(url.pathname);
    } catch {
      return false;
    }
  }
  return false;
}

export function getPlayableSources(video) {
  if (!video || video.embeddable === false) return [];
  return getPlaybackSources(video).filter(isPlayableSource);
}

export function getPrimaryPlaybackSource(video) {
  return getPlayableSources(video)[0] || null;
}

function matchesSource(video, source) {
  if (source === "all") return true;
  if (source === "wikimedia") return video.provider === "wikimedia";
  if (source === "archive" && video.source === "archive") return true;
  const sources = getPlayableSources(video);
  if (source === "direct") return sources.some((item) => ["mp4", "webm", "hls"].includes(item.source));
  return sources.some((item) => item.source === source);
}

export function filterCatalog(videos, filters, favorites = new Set(), now = Date.now()) {
  const query = normalizeSearch(filters.query || "");
  return videos.filter((video) => {
    if (filters.status === "favorites" && !favorites.has(video.id)) return false;
    if (["live", "upcoming", "replay"].includes(filters.status) && video.status !== filters.status) {
      return false;
    }
    if (
      filters.status === "latest" &&
      (!video.publishedAt || !Number.isFinite(new Date(video.publishedAt).getTime()) || new Date(video.publishedAt).getTime() < now - 60 * 86400_000)
    ) {
      return false;
    }
    if (filters.topic !== "all" && !video.topics?.includes(filters.topic)) return false;
    if (filters.language !== "all" && video.language !== filters.language) return false;
    if (!matchesSource(video, filters.source, now)) return false;
    if (!matchesDate(video, filters.date, now)) return false;
    if (query) {
      const haystack = normalizeSearch(
        `${video.title} ${video.channel} ${video.description} ${(video.topics || []).join(" ")}`,
      );
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function sortForDisplay(videos) {
  const weight = { live: 3, upcoming: 2, replay: 1 };
  return [...videos].sort((a, b) => {
    const statusDifference = (weight[b.status] || 0) - (weight[a.status] || 0);
    if (statusDifference) return statusDifference;
    if (a.status === "upcoming" && b.status === "upcoming") {
      return new Date(a.scheduledStart || a.publishedAt) - new Date(b.scheduledStart || b.publishedAt);
    }
    return new Date(b.publishedAt) - new Date(a.publishedAt) || b.score - a.score;
  });
}

export function isPlayableMovie(video) {
  return getPlayableSources(video).length > 0;
}

// Alias conservé pour compatibilité avec les anciennes versions/tests.
export const isPlayableConference = isPlayableMovie;
