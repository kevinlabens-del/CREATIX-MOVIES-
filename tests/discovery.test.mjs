import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverYouTubeCatalog,
  normalizeYouTubeVideo,
  parseIsoDuration,
} from "../netlify/functions/_shared/discovery.ts";

const NOW = new Date("2026-09-07T12:00:00.000Z");

function youtubeItem(overrides = {}) {
  return {
    id: "abcdefghijk",
    snippet: {
      title: "Public Domain Classic Full Movie Official",
      description: "A complete public domain feature film from an official movie archive.",
      channelTitle: "Classic Movies Official",
      publishedAt: "2026-09-01T12:00:00.000Z",
      defaultAudioLanguage: "en",
      liveBroadcastContent: "none",
      thumbnails: { high: { url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" } },
    },
    status: { embeddable: true, privacyStatus: "public", uploadStatus: "processed" },
    contentDetails: { duration: "PT1H2M3S" },
    liveStreamingDetails: {},
    ...overrides,
  };
}

test("parseIsoDuration comprend heures, minutes et secondes", () => {
  assert.equal(parseIsoDuration("PT1H2M3S"), 3723);
  assert.equal(parseIsoDuration("PT45M"), 2700);
  assert.equal(parseIsoDuration("P1DT2H"), 93600);
  assert.equal(parseIsoDuration("invalid"), null);
});

test("normalizeYouTubeVideo conserve un film public intégrable", () => {
  const normalized = normalizeYouTubeVideo(youtubeItem(), NOW);
  assert.ok(normalized);
  assert.equal(normalized.source, "youtube");
  assert.equal(normalized.status, "replay");
  assert.equal(normalized.durationSeconds, 3723);
  assert.equal(normalized.language, "en");
  assert.ok(normalized.score >= 32);
});

test("normalizeYouTubeVideo refuse les vidéos privées, non intégrables ou trop courtes", () => {
  assert.equal(
    normalizeYouTubeVideo(youtubeItem({ status: { embeddable: false, privacyStatus: "public", uploadStatus: "processed" } }), NOW),
    null,
  );
  assert.equal(
    normalizeYouTubeVideo(youtubeItem({ status: { embeddable: true, privacyStatus: "private", uploadStatus: "processed" } }), NOW),
    null,
  );
  assert.equal(
    normalizeYouTubeVideo(youtubeItem({ contentDetails: { duration: "PT2M" } }), NOW),
    null,
  );
  assert.equal(
    normalizeYouTubeVideo(
      youtubeItem({ contentDetails: { duration: "PT45M", regionRestriction: { blocked: ["FR"] } } }),
      NOW,
    ),
    null,
  );
});

test("les directs et événements à venir sont classés automatiquement", () => {
  const live = normalizeYouTubeVideo(
    youtubeItem({
      snippet: { ...youtubeItem().snippet, liveBroadcastContent: "live" },
      contentDetails: { duration: "P0D" },
      liveStreamingDetails: { actualStartTime: "2026-09-07T11:30:00.000Z" },
    }),
    NOW,
  );
  const upcoming = normalizeYouTubeVideo(
    youtubeItem({
      id: "lmnopqrstuv",
      snippet: { ...youtubeItem().snippet, liveBroadcastContent: "upcoming" },
      status: { embeddable: true, privacyStatus: "public", uploadStatus: "uploaded" },
      contentDetails: { duration: "P0D" },
      liveStreamingDetails: { scheduledStartTime: "2026-09-08T18:00:00.000Z" },
    }),
    NOW,
  );
  assert.equal(live?.status, "live");
  assert.equal(upcoming?.status, "upcoming");
});

test("un ancien direct conserve sa date de fin pour son statut de replay", () => {
  const completed = normalizeYouTubeVideo(
    youtubeItem({
      liveStreamingDetails: {
        actualStartTime: "2026-09-06T18:00:00.000Z",
        actualEndTime: "2026-09-06T20:00:00.000Z",
      },
    }),
    NOW,
  );
  assert.equal(completed?.status, "replay");
  assert.equal(completed?.actualEnd, "2026-09-06T20:00:00.000Z");
});

test("un événement non traité reste refusé lorsqu’il ne s’agit pas d’un direct", () => {
  assert.equal(
    normalizeYouTubeVideo(
      youtubeItem({
        status: { embeddable: true, privacyStatus: "public", uploadStatus: "uploaded" },
      }),
      NOW,
    ),
    null,
  );
});

test("un événement marqué à venir mais déjà daté dans le passé est exclu", () => {
  assert.equal(
    normalizeYouTubeVideo(
      youtubeItem({
        snippet: { ...youtubeItem().snippet, liveBroadcastContent: "upcoming" },
        status: { embeddable: true, privacyStatus: "public", uploadStatus: "uploaded" },
        contentDetails: { duration: "P0D" },
        liveStreamingDetails: { scheduledStartTime: "2026-09-01T18:00:00.000Z" },
      }),
      NOW,
    ),
    null,
  );
});

test("discoverYouTubeCatalog regroupe la recherche et valide les détails", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname.endsWith("/search")) {
      return Response.json({ items: [{ id: { videoId: "abcdefghijk" } }] });
    }
    if (url.pathname.endsWith("/videos")) {
      return Response.json({ items: [youtubeItem()] });
    }
    return new Response("Not found", { status: 404 });
  };

  const catalog = await discoverYouTubeCatalog("server-only-key", [], {
    fetchImpl,
    now: NOW,
    queryOffset: 0,
    queryBatchSize: 1,
  });
  assert.equal(catalog.mode, "youtube-api");
  assert.equal(catalog.videos.length, 1);
  assert.equal(catalog.videos[0].videoId, "abcdefghijk");
  const searchCalls = calls.filter((url) => url.pathname.endsWith("/search"));
  const eventCalls = searchCalls.filter((url) => url.searchParams.has("eventType"));
  assert.equal(searchCalls.length, 5);
  assert.equal(eventCalls.length, 4);
  assert.deepEqual(
    new Set(eventCalls.map((url) => `${url.searchParams.get("eventType")}:${url.searchParams.get("relevanceLanguage")}`)),
    new Set(["live:fr", "upcoming:fr", "live:en", "upcoming:en"]),
  );
  assert.ok(eventCalls.every((url) => url.searchParams.get("maxResults") === "25"));
  assert.ok(calls.every((url) => url.searchParams.get("key") === "server-only-key"));
});
