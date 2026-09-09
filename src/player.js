import { getPlayableSources } from "./catalog.js";

const sessions = new WeakMap();

export function clearPlayer(container) {
  const current = sessions.get(container);
  if (current) {
    current.disposed = true;
    current.cleanup.forEach((stop) => stop());
    current.cleanup = [];
  }
  sessions.delete(container);
  container.replaceChildren();
}

// Les lecteurs officiels conservent leurs contrôles, publicités et restrictions.
export async function loadPlayer(container, movie, autoplay = true, options = {}) {
  clearPlayer(container);
  const sources = getPlayableSources(movie);
  if (!sources.length) return { ok: false, reason: "Aucune source intégrable disponible." };
  const session = { disposed: false, cleanup: [], generation: 0, attempted: new Set() };
  sessions.set(container, session);
  const notify = (event) => {
    if (!session.disposed) options.onChange?.(event);
  };

  const mount = async (index, play = autoplay) => {
    session.cleanup.splice(0).forEach((stop) => stop());
    const generation = ++session.generation;
    const active = () => !session.disposed && generation === session.generation;
    session.attempted.add(index);
    const source = sources[index];
    container.replaceChildren();
    notify({ state: "mounted", source, index });
    const fail = () => {
      if (!active()) return;
      // Invalide immédiatement les événements tardifs du lecteur précédent.
      session.generation++;
      const next = sources.findIndex((_, i) => !session.attempted.has(i));
      if (next >= 0) {
        notify({ state: "fallback", source: sources[next], index: next });
        void mount(next, true);
        return;
      }
      session.cleanup.splice(0).forEach((stop) => stop());
      container.replaceChildren();
      const box = document.createElement("div");
      box.className = "player-placeholder";
      const message = document.createElement("p");
      message.textContent = "Ce film ne peut pas être lu ici pour le moment. Réessayez ou choisissez un autre film.";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "action-button";
      retry.textContent = "Réessayer";
      retry.addEventListener("click", () => {
        if (session.disposed) return;
        session.attempted.clear();
        void mount(index, true);
      }, { once: true });
      box.append(message, retry);
      container.append(box);
      notify({ state: "error", source, index });
    };

    if (["mp4", "webm", "hls"].includes(source.source)) {
      const video = document.createElement("video");
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.autoplay = play;
      video.setAttribute("aria-label", movie.title || "Film");
      if (movie.thumbnail) video.poster = movie.thumbnail;
      video.addEventListener("error", fail);
      video.addEventListener("playing", () => active() && notify({ state: "playing", source, index }));
      container.append(video);
      session.cleanup.push(() => {
        video.removeEventListener("error", fail);
        video.pause();
        video.removeAttribute("src");
        video.load();
      });
      if (source.source === "hls" && !video.canPlayType("application/vnd.apple.mpegurl")) {
        try {
          const moduleUrl = new URL("vendor/hls.mjs", document.baseURI).href;
          const { default: Hls } = await import(/* @vite-ignore */ moduleUrl);
          if (!active()) return;
          if (!Hls.isSupported()) { fail(); return; }
          const hls = new Hls();
          session.cleanup.push(() => hls.destroy());
          hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(); });
          hls.loadSource(source.playbackUrl);
          hls.attachMedia(video);
        } catch { if (active()) fail(); }
      } else {
        video.src = source.playbackUrl;
      }
      if (active() && play) video.play()?.catch(() => {}); // Le navigateur peut exiger un clic.
      return;
    }

    let url;
    if (source.source === "youtube") {
      url = new URL(`https://www.youtube-nocookie.com/embed/${source.videoId}`);
      url.searchParams.set("enablejsapi", "1");
      url.searchParams.set("playsinline", "1");
      url.searchParams.set("rel", "0");
      if (/^https?:$/.test(window.location.protocol)) url.searchParams.set("origin", window.location.origin);
    } else if (source.source === "dailymotion") {
      url = new URL("https://geo.dailymotion.com/player.html");
      url.searchParams.set("video", source.videoId);
    } else if (source.source === "onf") {
      url = new URL(source.playbackUrl);
    } else if (source.source === "vimeo") {
      url = new URL(`https://player.vimeo.com/video/${source.videoId}`);
    } else if (source.source === "archive") {
      url = new URL(`https://archive.org/embed/${encodeURIComponent(source.identifier)}`);
    } else { fail(); return; }
    url.searchParams.set("autoplay", play ? "1" : "0");
    const frame = document.createElement("iframe");
    frame.title = movie.title || "Lecteur du film";
    frame.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-forms");
    frame.addEventListener("error", fail);
    session.cleanup.push(() => frame.removeEventListener("error", fail));

    // YouTube annonce certaines erreurs par postMessage. Un chargement d'iframe
    // seul ne prouve jamais qu'une vidéo a démarré. Les autres lecteurs gardent
    // leur propre message d'erreur et le sélecteur de source reste disponible.
    if (source.source === "youtube") {
      let attempts = 0;
      let timer;
      const listen = () => {
        if (!active() || ++attempts > 10) { clearInterval(timer); return; }
        frame.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: "creatix-player" }), url.origin);
        frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onError"] }), url.origin);
        frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onStateChange"] }), url.origin);
      };
      const receive = (event) => {
        if (!active() || event.source !== frame.contentWindow || event.origin !== url.origin) return;
        let data;
        try { data = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
        if (data?.event === "onError") fail();
        if (data?.event === "onStateChange" && data.info === 1) notify({ state: "playing", source, index });
      };
      frame.addEventListener("load", () => { listen(); timer = setInterval(listen, 1000); }, { once: true });
      window.addEventListener("message", receive);
      session.cleanup.push(() => { clearInterval(timer); window.removeEventListener("message", receive); });
    }
    frame.src = url.href;
    container.append(frame);
  };

  const index = Number.isInteger(options.sourceIndex) && options.sourceIndex >= 0 && options.sourceIndex < sources.length ? options.sourceIndex : 0;
  await mount(index);
  return { ok: !session.disposed, source: sources[index] };
}

export async function requestPlayerFullscreen(container) {
  if (container.requestFullscreen) { await container.requestFullscreen(); return true; }
  if (container.webkitRequestFullscreen) { container.webkitRequestFullscreen(); return true; }
  const video = container.querySelector("video");
  if (video?.webkitEnterFullscreen) { video.webkitEnterFullscreen(); return true; }
  return false;
}
