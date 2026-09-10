import { readFile } from "node:fs/promises";

export const config = JSON.parse(await readFile(new URL("../config/sources.json", import.meta.url), "utf8"));
export const MIN_SECONDS = config.minimumDurationSeconds;
export const fold = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export const asText = (value) => Array.isArray(value) ? value.join(" ") : String(value ?? "");
export function decode(value = "") {
  return String(value).replace(/&(?:amp|quot|apos|lt|gt|#39|#x27|nbsp);/g, (entity) => ({"&amp;":"&","&quot;":'"',"&apos;":"'","&lt;":"<","&gt;":">","&#39;":"'","&#x27;":"'","&nbsp;":" "}[entity]))
    .replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : "");
}
export const clean = (value) => decode(asText(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
export function seconds(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : null;
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.round(Number(raw));
  const iso = String(raw).match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (iso) return (+iso[1] || 0) * 86400 + (+iso[2] || 0) * 3600 + (+iso[3] || 0) * 60 + (+iso[4] || 0);
  const parts = String(raw).split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((x) => !Number.isFinite(x))) return null;
  return parts.reduce((n, p) => n * 60 + p, 0);
}
export function frenchEvidence({ title = "", audioLanguage = "", language = "", audioTracks = [] } = {}) {
  const t = fold(title);
  const frenchTrack = audioTracks.some((track) => /^fr(?:[-.]|$)/i.test(track.id || "") || /francais|french/i.test(fold(track.displayName || "")));
  if (frenchTrack) return { language: "fr", languageLabel: "Français · piste audio", evidence: "audio-track" };
  if (/^fr(?:[-_]|$)|^(?:fre|fra|french|francais)$/i.test(fold(audioLanguage || language))) return { language: "fr", languageLabel: "Français", evidence: "publisher-audio" };
  if (/\bvost(?:fr)?\b|sous[ -]?titre|french subtitles/.test(t)) return null;
  if (/\bvf\b|\bvff\b|version francaise|(?:en |in )francais|in french|film complet (?:fr\b|francais)/.test(t)) return { language: "fr", languageLabel: "VF annoncée", evidence: "publisher-title" };
  return null;
}
export function isFeature(title, duration, { documentary = false, trustedFilmCatalog = false, allowEpisode = false } = {}) {
  if (!Number.isFinite(duration) || duration > 6 * 3600) return false;
  const t = fold(title).replace(/[–—]/g, "-");
  if (/\b(trailer|teaser|extraits?|bande[ -]annonce|preview|making[ -]of|interview|podcast|reaction|recap|compilation|marathon|shorts?|court[ -]metrage)\b/.test(t)) return false;
  const episode = /\b(?:episode|saison|partie|part)\s*\d|\bS\d{1,2}E\d{1,2}\b|\b\d\s*\/\s*\d\b/i.test(t);
  if (episode) return allowEpisode && duration >= 8 * 60;
  if (duration < MIN_SECONDS) return false;
  return trustedFilmCatalog || /film complet|full (?:length )?(?:movie|film)|integral|long[ -]metrage|complete movie/.test(t) || (documentary && duration >= MIN_SECONDS);
}
export function topicsFor(value, documentary = false) {
  const t = fold(value), topics = [];
  for (const [name, pattern] of Object.entries({Action:/action|combat|guerre|martial/,"Science-fiction":/science.fiction|sci.fi|alien|spatial/,Horreur:/horreur|horror|vampire|zombie/,Comédie:/comedie|comedy|humour/,Thriller:/thriller|policier|suspense|crime/,Drame:/drame|drama/,Animation:/animation|anime/,Aventure:/aventure|adventure|western/})) if (pattern.test(t)) topics.push(name);
  if (documentary || /documentaire|documentary/.test(t)) topics.push("Documentaire");
  return [...new Set([...topics, "Français"])];
}
export function movieKey(video) {
  let title = fold(video.title).replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  title = title.replace(/(?:film complet|full movie|version francaise|en francais|\bvf\b|\bvff\b|\bhd\b|\b4k\b|\b1080p\b|\b720p\b)/g, " ").replace(/[|⎪].*$/, "").replace(/[^a-z0-9]+/g, " ").trim();
  return title.length >= 4 ? title : video.id;
}
export function mergeMovies(videos) {
  const result = [], byId = new Map(), byTitle = new Map();
  for (const video of videos) {
    const allowEpisode = video?.contentType === "episode";
    if (!video?.id || video.language !== "fr" || !isFeature(video.title, video.durationSeconds, {trustedFilmCatalog: true, allowEpisode})) continue;
    const credits = video.credits?.length ? video.credits : [{sourceUrl:video.sourceUrl,rights:video.rights,rightsUrl:video.rightsUrl,attribution:video.attribution}];
    const key = movieKey(video);
    const sameTitle = (byTitle.get(key) || []).find((other) => Math.abs(other.durationSeconds - video.durationSeconds) <= 90 && (!other.releaseYear || !video.releaseYear || other.releaseYear === video.releaseYear));
    const previous = byId.get(video.id) || sameTitle;
    if (previous) {
      const all = [...(previous.playbackSources || []), ...(video.playbackSources || [])];
      previous.playbackSources = [...new Map(all.map((s) => [JSON.stringify([s.source,s.videoId,s.identifier,s.playbackUrl]), s])).values()];
      previous.credits = [...new Map([...(previous.credits || []), ...credits].map((c) => [c.sourceUrl || c.rights, c])).values()];
      previous.alternateIds = [...new Set([...(previous.alternateIds || []), video.id])].filter((id) => id !== previous.id);
      continue;
    }
    const item = structuredClone(video);
    item.credits = structuredClone(credits);
    result.push(item); byId.set(item.id, item); byTitle.set(key, [...(byTitle.get(key) || []), item]);
  }
  return result;
}
export async function mapLimit(items, limit, worker) {
  let next = 0;
  const output = new Array(items.length);
  await Promise.all(Array.from({length:Math.min(limit, items.length)}, async () => {
    while (next < items.length) { const i = next++; output[i] = await worker(items[i], i); }
  }));
  return output;
}
export async function request(url, { json = false, timeout = 20000, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {headers:{Accept:json?"application/json":"text/html,application/xml;q=0.9,*/*;q=0.8", "User-Agent":"CR3ATIX-MOVIES/1.3 (catalogue francais)"}, signal:AbortSignal.timeout(timeout)});
  if (!response.ok) { const error = new Error(`HTTP ${response.status}`); error.status = response.status; throw error; }
  return json ? response.json() : response.text();
}
export function jsonAssignment(html, name) {
  const marker = new RegExp(`(?:var\\s+)?${name}\\s*=\\s*`);
  const match = marker.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped=false; else if(c==="\\") escaped=true; else if(c==='"') quoted=false; continue; }
    if(c==='"') quoted=true;
    else if(c==='{' || c==='[') depth++;
    else if(c==='}' || c===']') { if(--depth===0) { try{return JSON.parse(html.slice(start,i+1));}catch{return null;} } }
  }
  return null;
}
export function* walkKeys(value, key) {
  if (!value || typeof value !== "object") return;
  if (Object.hasOwn(value,key)) yield value[key];
  for (const child of Object.values(value)) yield* walkKeys(child,key);
}
export const ytText = (value) => value?.simpleText || value?.content || value?.runs?.map((r)=>r.text).join("") || "";
