const ARCHIVE_SEARCH = "https://archive.org/advancedsearch.php";
const ARCHIVE_METADATA = "https://archive.org/metadata";
const MIN_MOVIE_SECONDS = 40 * 60;
const TARGET_SIZE = 120;
const SEARCH_ROWS = 180;
const CONCURRENCY = 8;

const PUBLIC_DOMAIN_LICENSES = [
  "creativecommons.org/publicdomain/mark/1.0",
  "creativecommons.org/publicdomain/zero/1.0",
];

function text(value) {
  if (Array.isArray(value)) return value.join(" ");
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function fold(value = "") {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const single = text(value).trim();
  return single ? [single] : [];
}

function parseDuration(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const raw = text(value).trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.round(Number(raw));
  const parts = raw.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
  return null;
}

function isExplicitlyPublicDomain(metadata = {}) {
  const license = fold(text(metadata.licenseurl));
  const rights = fold(`${text(metadata.rights)} ${text(metadata.usage)} ${text(metadata.possible_copyright_status)}`);
  return (
    PUBLIC_DOMAIN_LICENSES.some((needle) => license.includes(needle)) ||
    /\bpublic domain\b/.test(rights) ||
    /\bdomaine public\b/.test(rights) ||
    /\bcc0\b/.test(rights)
  );
}

function canonicalRights(metadata = {}) {
  const license = normalizeArray(metadata.licenseurl).find((url) =>
    PUBLIC_DOMAIN_LICENSES.some((needle) => fold(url).includes(needle)),
  );
  if (license) {
    return {
      rights: fold(license).includes("zero/1.0") ? "CC0 / Public Domain" : "Public Domain",
      rightsUrl: license,
    };
  }
  return { rights: text(metadata.rights) || "Public Domain", rightsUrl: "" };
}

function detectLanguage(metadata = {}) {
  const declared = fold(text(metadata.language));
  if (/\b(fr|fre|fra|french|francais|français)\b/.test(declared)) return "fr";
  if (/\b(en|eng|english)\b/.test(declared)) return "en";
  return "other";
}

function classifyTopics(metadata = {}, language = "other") {
  const combined = fold(
    `${text(metadata.title)} ${text(metadata.description)} ${text(metadata.subject)} ${text(metadata.genre)}`,
  );
  const topics = [];
  const add = (name, terms) => {
    if (terms.some((term) => combined.includes(term))) topics.push(name);
  };
  add("Action", ["action", "martial", "war", "combat", "guerre"]);
  add("Science-fiction", ["science fiction", "sci-fi", "scifi", "space", "alien", "futur"]);
  add("Horreur", ["horror", "horreur", "zombie", "vampire", "ghost", "haunted"]);
  add("Comédie", ["comedy", "comedie", "comédie", "humor", "humour"]);
  add("Thriller", ["thriller", "suspense", "crime", "mystery", "mystere", "mystère"]);
  add("Drame", ["drama", "drame", "melodrama"]);
  add("Animation", ["animation", "animated", "cartoon", "anime"]);
  add("Aventure", ["adventure", "aventure", "western", "swashbuckler"]);
  add("Documentaire", ["documentary", "documentaire", "nonfiction", "non-fiction"]);
  if (!topics.length) topics.push("Classiques");
  if (!topics.includes("Classiques")) topics.push("Classiques");
  if (language === "fr") topics.push("Français");
  if (language === "en") topics.push("Anglais");
  return [...new Set(topics)];
}

function publicationDate(metadata = {}) {
  const candidates = [metadata.date, metadata.publicdate, metadata.addeddate];
  for (const candidate of candidates) {
    const raw = text(candidate).trim();
    if (!raw) continue;
    if (/^\d{4}$/.test(raw)) return `${raw}-01-01T00:00:00.000Z`;
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date(0).toISOString();
}

function cleanDescription(metadata = {}) {
  return text(metadata.description)
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
}

function candidateVideoFiles(files = []) {
  return files
    .filter((file) => file && typeof file.name === "string")
    .map((file) => ({
      file,
      duration: parseDuration(file.length),
      name: file.name,
      lowerName: file.name.toLowerCase(),
    }))
    .filter(({ file, lowerName }) => {
      if (file.private === true || file.private === "true") return false;
      if (/sample|trailer|preview|clip/.test(lowerName)) return false;
      return /\.(mp4|webm)$/i.test(lowerName);
    })
    .sort((a, b) => (b.duration || 0) - (a.duration || 0));
}

function directSource(identifier, candidate) {
  if (!candidate) return null;
  const extension = candidate.lowerName.endsWith(".webm") ? "webm" : "mp4";
  const path = candidate.name.split("/").map(encodeURIComponent).join("/");
  return {
    source: extension,
    playbackUrl: `https://archive.org/download/${encodeURIComponent(identifier)}/${path}`,
    embeddable: true,
    label: `Internet Archive · ${extension.toUpperCase()}`,
  };
}

async function fetchJson(url, timeoutMs = 20_000) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CR3ATIX-MOVIES/1.2" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function searchArchive() {
  const url = new URL(ARCHIVE_SEARCH);
  // Search wide, then re-check every item's metadata. The metadata validation below is authoritative.
  url.searchParams.set("q", "mediatype:movies AND (licenseurl:*publicdomain* OR licenseurl:*zero*)");
  for (const field of ["identifier", "title", "downloads", "date", "creator", "language", "licenseurl"]) {
    url.searchParams.append("fl[]", field);
  }
  url.searchParams.set("rows", String(SEARCH_ROWS));
  url.searchParams.set("page", "1");
  url.searchParams.set("sort[]", "downloads desc");
  url.searchParams.set("output", "json");
  const payload = await fetchJson(url);
  return Array.isArray(payload?.response?.docs) ? payload.response.docs : [];
}

async function mapWithConcurrency(items, worker, concurrency = CONCURRENCY) {
  const results = new Array(items.length);
  let index = 0;
  async function runner() {
    while (index < items.length) {
      const current = index++;
      try {
        results[current] = await worker(items[current], current);
      } catch (error) {
        results[current] = null;
        console.warn(`Archive item skipped: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

async function inspectArchiveItem(doc) {
  const identifier = text(doc?.identifier).trim();
  if (!/^[A-Za-z0-9._-]{2,160}$/.test(identifier)) return null;
  const payload = await fetchJson(`${ARCHIVE_METADATA}/${encodeURIComponent(identifier)}`, 18_000);
  const metadata = payload?.metadata || {};
  if (!isExplicitlyPublicDomain(metadata)) return null;

  const candidates = candidateVideoFiles(Array.isArray(payload?.files) ? payload.files : []);
  const longest = candidates[0];
  if (!longest || !longest.duration || longest.duration < MIN_MOVIE_SECONDS) return null;

  const title = text(metadata.title || doc.title).trim();
  if (!title) return null;
  const combined = fold(`${title} ${text(metadata.description)} ${text(metadata.subject)}`);
  if (/\b(trailer|preview|sample|commercial|advertisement|newsreel|short film|court metrage)\b/.test(combined)) {
    return null;
  }

  const language = detectLanguage(metadata);
  const { rights, rightsUrl } = canonicalRights(metadata);
  const direct = directSource(identifier, longest);
  const playbackSources = [
    {
      source: "archive",
      identifier,
      embeddable: true,
      label: "Internet Archive · Public Domain",
    },
    ...(direct ? [direct] : []),
  ];
  const downloads = Number(metadata.downloads ?? doc.downloads ?? 0) || 0;
  const popularity = Math.min(20, Math.round(Math.log10(downloads + 1) * 4));

  return {
    id: `archive:${identifier}`,
    title,
    channel: text(metadata.creator) || "Internet Archive",
    description: cleanDescription(metadata) || "Long métrage disponible légalement via Internet Archive.",
    thumbnail: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
    publishedAt: publicationDate(metadata),
    status: "replay",
    language,
    durationSeconds: longest.duration,
    topics: classifyTopics(metadata, language),
    score: Math.min(100, 72 + popularity),
    embeddable: true,
    source: "archive",
    identifier,
    sourceLabel: "Internet Archive · Public Domain",
    rights,
    rightsUrl,
    archiveUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    playbackSources,
  };
}

export async function discoverArchiveCatalog() {
  const docs = await searchArchive();
  const inspected = await mapWithConcurrency(docs, inspectArchiveItem);
  const videos = inspected
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.durationSeconds - a.durationSeconds)
    .slice(0, TARGET_SIZE);
  return {
    version: 5,
    mode: "archive-public-domain",
    generatedAt: new Date().toISOString(),
    videos,
    notice: videos.length
      ? `${videos.length} films du domaine public vérifiés automatiquement.`
      : "Aucun nouveau film du domaine public n’a pu être vérifié pendant cette synchronisation.",
  };
}
