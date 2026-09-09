import assert from "node:assert/strict";
import test from "node:test";
import {
  countCatalog,
  filterCatalog,
  formatCountdown,
  formatDateTime,
  formatDuration,
  getConferenceTimingLabel,
  getStatusLabel,
  isPlayableConference,
} from "../src/catalog.js";

const videos = [
  {
    id: "youtube:abcdefghijk",
    source: "youtube",
    videoId: "abcdefghijk",
    embeddable: true,
    title: "Film classique français",
    channel: "Cinéma Officiel",
    description: "Film complet du domaine public",
    status: "live",
    publishedAt: "2026-09-06T12:00:00.000Z",
    language: "fr",
    topics: ["Classiques", "Français"],
    score: 92,
  },
  {
    id: "youtube:lmnopqrstuv",
    source: "youtube",
    videoId: "lmnopqrstuv",
    embeddable: true,
    title: "Classic thriller full movie",
    channel: "Movies Official",
    description: "Public domain feature film",
    status: "replay",
    publishedAt: "2026-05-01T12:00:00.000Z",
    language: "en",
    topics: ["Thriller", "Classiques", "Anglais"],
    score: 81,
  },
];

test("formatDuration produit des durées lisibles", () => {
  assert.equal(formatDuration(7440), "2 h 04");
  assert.equal(formatDuration(937), "15 min");
  assert.equal(formatDuration(null), "Durée variable");
});

test("formatCountdown gère les événements futurs", () => {
  const now = new Date("2026-09-07T12:00:00.000Z").getTime();
  assert.equal(formatCountdown("2026-09-08T14:30:00.000Z", now), "Dans 1 j 2 h");
  assert.equal(formatCountdown("2026-09-07T12:20:00.000Z", now), "Dans 20 min");
});

test("les vignettes utilisent uniquement les trois statuts du catalogue", () => {
  const upcoming = {
    ...videos[0],
    status: "upcoming",
    scheduledStart: "2026-09-09T00:00:00.000Z",
  };
  const completedLive = {
    ...videos[1],
    actualEnd: "2026-09-06T20:00:00.000Z",
  };

  assert.equal(getStatusLabel(videos[0]), "Première");
  assert.equal(getStatusLabel(upcoming), "À venir");
  assert.equal(getStatusLabel(completedLive), "Disponible");
  assert.equal(getStatusLabel(videos[1]), "Disponible");
  assert.match(getConferenceTimingLabel(upcoming), /^Prévu · .*2026/);
  assert.match(getConferenceTimingLabel(completedLive), /^Terminé · .*2026/);
  assert.match(formatDateTime(upcoming.scheduledStart), /2026/);
});

test("filterCatalog combine recherche, langue, thème et favoris", () => {
  const base = { status: "all", topic: "all", language: "all", date: "all", source: "all", query: "" };
  assert.equal(filterCatalog(videos, { ...base, language: "fr" }).length, 1);
  assert.equal(filterCatalog(videos, { ...base, topic: "Thriller" }).length, 1);
  assert.equal(filterCatalog(videos, { ...base, query: "cinema" }).length, 1);
  assert.equal(filterCatalog(videos, { ...base, status: "favorites" }, new Set([videos[1].id])).length, 1);
});

test("seules les sources internes valides sont déclarées lisibles", () => {
  assert.equal(isPlayableConference(videos[0]), true);
  assert.equal(isPlayableConference({ ...videos[0], embeddable: false }), false);
  assert.equal(isPlayableConference({ ...videos[0], videoId: "bad" }), false);
  assert.equal(
    isPlayableConference({
      ...videos[0],
      id: "hls:test",
      source: "hls",
      videoId: undefined,
      playbackUrl: "https://media.example.test/live.m3u8",
    }),
    true,
  );
  assert.equal(
    isPlayableConference({
      ...videos[0],
      id: "mp4:test",
      source: "mp4",
      videoId: undefined,
      playbackUrl: "javascript:alert(1)",
    }),
    false,
  );
  assert.equal(
    isPlayableConference({
      ...videos[0],
      id: "mp4:wrong-extension",
      source: "mp4",
      videoId: undefined,
      playbackUrl: "https://media.example.test/live.m3u8",
    }),
    false,
  );
});

test("countCatalog sépare les statuts", () => {
  assert.deepEqual(countCatalog(videos), { total: 2, live: 1, upcoming: 0, replay: 1 });
});
