import assert from "node:assert/strict";
import test from "node:test";
import { discoverArchiveCatalog } from "../scripts/archive-catalog.mjs";

test("le catalogue Archive ne conserve qu'un long métrage explicitement domaine public", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("advancedsearch.php")) {
      return new Response(JSON.stringify({
        response: { docs: [{ identifier: "legal-feature", title: "Legal Feature", downloads: 1000 }] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/metadata/legal-feature")) {
      return new Response(JSON.stringify({
        metadata: {
          identifier: "legal-feature",
          title: "Legal Feature",
          creator: "Test Studio",
          description: "Public domain feature film comedy",
          date: "1940",
          language: "eng",
          subject: ["Comedy", "Feature films"],
          licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/",
          downloads: "1000"
        },
        files: [{ name: "legal-feature.mp4", format: "MPEG4", length: "01:22:00", size: "1000000" }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
  try {
    const catalog = await discoverArchiveCatalog();
    assert.equal(catalog.mode, "archive-public-domain");
    assert.equal(catalog.videos.length, 1);
    assert.equal(catalog.videos[0].id, "archive:legal-feature");
    assert.equal(catalog.videos[0].rights, "Public Domain");
    assert.ok(catalog.videos[0].playbackSources.some((source) => source.source === "archive"));
    assert.ok(catalog.videos[0].playbackSources.some((source) => source.source === "mp4"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
