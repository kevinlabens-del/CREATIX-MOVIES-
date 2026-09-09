export type ConferenceStatus = "live" | "upcoming" | "replay";
export type ConferenceLanguage = "fr" | "en" | "other";
export type ConferenceSource = "youtube" | "vimeo" | "mp4" | "webm" | "hls";

export interface Conference {
  id: string;
  source: ConferenceSource;
  videoId?: string;
  playbackUrl?: string;
  title: string;
  channel: string;
  description: string;
  status: ConferenceStatus;
  publishedAt: string;
  scheduledStart?: string;
  actualStart?: string;
  actualEnd?: string;
  durationSeconds: number | null;
  language: ConferenceLanguage;
  topics: string[];
  thumbnail: string;
  score: number;
  embeddable: true;
  lastCheckedAt?: string;
}

export interface CatalogPayload {
  version: 3;
  mode: "youtube-api" | "verified-fallback";
  generatedAt: string;
  videos: Conference[];
  notice?: string;
}
