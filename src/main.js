import {
  STATUS_FILTERS,
  TOPIC_FILTERS,
  countCatalog,
  filterCatalog,
  formatCountdown,
  formatDuration,
  getConferenceTimingLabel,
  getStatusLabel,
  getPrimaryPlaybackSource,
  getPlayableSources,
  isPlayableMovie,
  sortForDisplay,
} from "./catalog.js";
import { loadPlayer, requestPlayerFullscreen } from "./player.js";

const FAVORITES_KEY = "creatix-movies:favorites:v1";
const SELECTED_KEY = "creatix-movies:selected:v1";
const CATALOG_REQUEST_TIMEOUT_MS = 30_000;
const CATALOG_RECOVERY_DELAY_MS = 8_000;
const APP_BASE_URL = new URL("./", document.baseURI).pathname;
const appUrl = (path = "") => new URL(path.replace(/^\/+/, ""), document.baseURI).href;
// Cette distribution fonctionne directement sur un serveur statique/local et sur GitHub Pages.
const STATIC_CATALOG = true;
const CATALOG_URL = appUrl("data/catalog.json");
const validStatuses = new Set(STATUS_FILTERS.map((item) => item.id));
const initialStatus = new URLSearchParams(window.location.search).get("status");
let catalogRecoveryTimer = null;

const state = {
  videos: [],
  selectedId: null,
  favorites: readFavorites(),
  filters: {
    status: validStatuses.has(initialStatus) ? initialStatus : "all",
    topic: "all",
    language: "fr",
    date: "all",
    source: "all",
    query: "",
  },
  mode: "local-catalog",
  sources: [],
  visibleLimit: 48,
  playbackIndex: 0,
  generatedAt: null,
  notice: "",
  loading: true,
  refreshing: false,
};

document.querySelector("#app").innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup" aria-label="CR3@TIX MOVIES">
        <img class="brand-mark" src="${appUrl("icons/icon.svg")}" alt="" width="48" height="48">
        <div>
          <p class="eyebrow">CR3@TIX</p>
          <h1><span>MOVIES</span></h1>
        </div>
      </div>
      <p class="brand-line">Films complets en français, directement dans votre lecteur.</p>
      <div class="topbar-actions">
        <span id="network-state" class="network-state" role="status">
          <i aria-hidden="true"></i><span>Connexion active</span>
        </span>
        <button id="install-app" class="action-button install-button" type="button" hidden>
          <span aria-hidden="true">＋</span> Installer
        </button>
        <button id="refresh-catalog" class="action-button" type="button">
          <span class="refresh-icon" aria-hidden="true">↻</span>
          <span>Actualiser</span>
        </button>
      </div>
    </header>

    <main>
      <section class="broadcast-stage" aria-labelledby="now-playing-title">
        <div class="player-column">
          <div class="section-kicker">
            <span class="signal-bars" aria-hidden="true"><i></i><i></i><i></i></span>
            Salle principale
          </div>
          <div class="player-frame">
            <div id="video-player" class="video-player" aria-live="polite">
              <div class="player-placeholder">
                <img src="${appUrl("icons/icon.svg")}" alt="" width="88" height="88">
                <p>Préparation du lecteur intégré…</p>
              </div>
            </div>
            <div class="player-chrome" aria-hidden="true">
              <span>CR3@TIX // SALLE DE CINÉMA</span>
              <span>MOVIES V1.3</span>
            </div>
            <button id="fullscreen-player" class="fullscreen-button" type="button" aria-label="Afficher le lecteur en plein écran" title="Plein écran">
              ⛶
            </button>
          </div>

          <article class="now-playing" aria-live="polite">
            <div class="now-playing-main">
              <div class="now-playing-labels">
                <span id="selected-status" class="status-badge status-replay">Replay</span>
                <span id="selected-source" class="source-label">YouTube intégré</span>
              </div>
              <h2 id="now-playing-title">Sélectionnez un film</h2>
              <p id="selected-channel" class="selected-channel">Le catalogue se prépare.</p>
              <div id="selected-facts" class="selected-facts"></div>
            </div>
            <button id="favorite-selected" class="favorite-large" type="button" aria-label="Ajouter le film aux favoris" disabled>
              <span aria-hidden="true">☆</span>
            </button>
            <p id="selected-description" class="selected-description"></p>
            <div class="playback-options">
              <label for="playback-source">Source de lecture</label>
              <select id="playback-source" aria-label="Choisir une source de lecture"></select>
              <p id="playback-note" role="status">Lancez la vidéo avec les commandes du lecteur.</p>
            </div>
            <details class="film-credits"><summary>Source et crédits</summary><div id="film-credits"></div></details>
            <div id="selected-topics" class="selected-topics" aria-label="Thèmes"></div>
          </article>
        </div>

        <aside class="signal-panel" aria-label="État du catalogue">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Radar cinéma</p>
              <h2>État du catalogue</h2>
            </div>
            <span id="catalog-mode" class="catalog-mode">Vérification</span>
          </div>
          <div class="stat-grid">
            <div class="stat-card stat-total">
              <strong id="stat-total">—</strong>
              <span>films</span>
            </div>
            <div class="stat-card stat-live">
              <strong id="stat-live">—</strong>
              <span>en français</span>
            </div>
            <div class="stat-card stat-upcoming">
              <strong id="stat-upcoming">—</strong>
              <span>plateformes</span>
            </div>
          </div>
          <div class="queue-heading">
            <span>À découvrir</span>
            <span id="queue-count">0</span>
          </div>
          <div id="signal-queue" class="signal-queue">
            <div class="queue-skeleton"></div>
            <div class="queue-skeleton"></div>
            <div class="queue-skeleton"></div>
          </div>
          <div class="inside-only-note">
            <span class="shield-mark" aria-hidden="true">◇</span>
            <div>
              <strong>Lecture interne uniquement</strong>
              <p>Les lecteurs restent dans l’application. La disponibilité dépend de la source et de votre pays.</p>
            </div>
          </div>
        </aside>
      </section>

      <section id="catalogue" class="catalog-section" aria-labelledby="catalog-title">
        <div class="catalog-heading">
          <div>
            <p class="eyebrow">Cinémathèque dynamique</p>
            <h2 id="catalog-title">Films disponibles</h2>
          </div>
          <p id="catalog-updated" class="catalog-updated">Synchronisation en cours…</p>
        </div>

        <nav id="status-tabs" class="status-tabs" aria-label="Catégories de diffusion"></nav>

        <div class="filter-deck">
          <label class="search-field">
            <span class="search-icon" aria-hidden="true">⌕</span>
            <span class="sr-only">Rechercher dans les films</span>
            <input id="catalog-search" type="search" placeholder="Titre, chaîne, thème…" autocomplete="off">
            <kbd>⌘ K</kbd>
          </label>
          <label>
            <span class="sr-only">Langue</span>
            <select id="language-filter" aria-label="Filtrer par langue">
              <option value="all">Toutes les langues</option>
              <option value="fr" selected>Français</option>
            </select>
          </label>
          <label>
            <span class="sr-only">Date</span>
            <select id="date-filter" aria-label="Filtrer par date">
              <option value="all">Toutes les dates</option>
              <option value="7">7 derniers jours</option>
              <option value="30">30 derniers jours</option>
              <option value="90">3 derniers mois</option>
              <option value="365">12 derniers mois</option>
            </select>
          </label>
          <label>
            <span class="sr-only">Source</span>
            <select id="source-filter" aria-label="Filtrer par source">
              <option value="all">Toutes les sources</option>
              <option value="youtube">YouTube intégré</option>
              <option value="dailymotion">Dailymotion intégré</option>
              <option value="onf">ONF · Canada</option>
              <option value="wikimedia">Wikimedia Commons</option>
              <option value="archive">Internet Archive</option>
              <option value="direct">MP4 · WebM · HLS</option>
            </select>
          </label>
        </div>

        <nav id="topic-tabs" class="topic-tabs" aria-label="Genres de films"></nav>

        <div class="results-line">
          <p><strong id="result-count">0</strong> films et documentaires</p>
          <button id="clear-filters" class="text-button" type="button" hidden>Effacer les filtres</button>
        </div>

        <div id="catalog-grid" class="catalog-grid" aria-live="polite" aria-busy="true">
          ${Array.from({ length: 8 }, () => '<div class="catalog-skeleton"><i></i><span></span><span></span></div>').join("")}
        </div>
        <button id="load-more" class="action-button load-more" type="button" hidden>Afficher plus de films</button>
        <div id="empty-state" class="empty-state" hidden>
          <span aria-hidden="true">⌁</span>
          <h3>Aucun film ne correspond</h3>
          <p>Modifiez la recherche ou retirez un filtre.</p>
          <button class="action-button" type="button">Voir tout le catalogue</button>
        </div>
        <details class="source-health">
          <summary>Les catalogues connectés</summary>
          <p>Films d’au moins 40 minutes, avec une indication de français et un lecteur intégrable dans les métadonnées de la source. Ces indications ne garantissent pas la lecture sur chaque appareil.</p>
          <div id="source-health"></div>
        </details>
      </section>
    </main>

    <footer>
      <span>CR3@TIX MOVIES</span>
      <span>Observer · Inspirer · Évoluer</span>
      <span>V1.3 — films en français · lecteur intégré</span>
    </footer>

    <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  </div>
`;

const elements = {
  player: document.querySelector("#video-player"),
  title: document.querySelector("#now-playing-title"),
  channel: document.querySelector("#selected-channel"),
  facts: document.querySelector("#selected-facts"),
  description: document.querySelector("#selected-description"),
  topics: document.querySelector("#selected-topics"),
  status: document.querySelector("#selected-status"),
  source: document.querySelector("#selected-source"),
  favoriteSelected: document.querySelector("#favorite-selected"),
  grid: document.querySelector("#catalog-grid"),
  queue: document.querySelector("#signal-queue"),
  statusTabs: document.querySelector("#status-tabs"),
  topicTabs: document.querySelector("#topic-tabs"),
  resultCount: document.querySelector("#result-count"),
  empty: document.querySelector("#empty-state"),
  clearFilters: document.querySelector("#clear-filters"),
  refresh: document.querySelector("#refresh-catalog"),
  install: document.querySelector("#install-app"),
  network: document.querySelector("#network-state"),
  updated: document.querySelector("#catalog-updated"),
  mode: document.querySelector("#catalog-mode"),
  toast: document.querySelector("#toast"),
  loadMore: document.querySelector("#load-more"),
  playbackSource: document.querySelector("#playback-source"),
  playbackNote: document.querySelector("#playback-note"),
  credits: document.querySelector("#film-credits"),
  sourceHealth: document.querySelector("#source-health"),
};

function readFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function persistFavorites() {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites])); } catch {}
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function getSelected() {
  return state.videos.find((video) => video.id === state.selectedId) || null;
}

function getSourceLabel(video, selectedSource = null) {
  const primary = selectedSource || getPrimaryPlaybackSource(video);
  const labels = {
    youtube: "YouTube intégré",
    vimeo: "Vimeo intégré",
    dailymotion: "Dailymotion intégré",
    onf: "ONF · lecteur officiel",
    mp4: "Vidéo MP4",
    webm: "Vidéo WebM",
    hls: "Flux HLS",
    archive: "Internet Archive",
  };
  return primary?.label || labels[primary?.source] || "Lecteur intégré";
}

function renderStatusTabs() {
  elements.statusTabs.replaceChildren();
  STATUS_FILTERS.forEach((filter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `status-tab status-tab-${filter.id}`;
    button.dataset.status = filter.id;
    button.setAttribute("aria-pressed", String(state.filters.status === filter.id));
    const icon = createTextElement("span", "tab-icon", filter.icon);
    icon.setAttribute("aria-hidden", "true");
    button.append(icon, document.createTextNode(filter.label));

    const count =
      filter.id === "favorites"
        ? state.videos.filter((video) => state.favorites.has(video.id)).length
        : filter.id === "latest"
          ? filterCatalog(state.videos, { ...state.filters, status: "latest", query: "", topic: "all", language: "all", date: "all", source: "all" }, state.favorites).length
          : filter.id === "all"
            ? state.videos.length
            : state.videos.filter((video) => video.status === filter.id).length;
    button.append(createTextElement("span", "tab-count", String(count)));
    elements.statusTabs.append(button);
  });
}

function renderTopicTabs() {
  elements.topicTabs.replaceChildren();
  const topics = ["all", ...TOPIC_FILTERS.filter((topic) => state.videos.some((video) => video.topics?.includes(topic)))];
  topics.forEach((topic) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.topic = topic;
    button.className = "topic-tab";
    button.setAttribute("aria-pressed", String(state.filters.topic === topic));
    button.textContent = topic === "all" ? "Tous les thèmes" : topic;
    elements.topicTabs.append(button);
  });
}

function makeFact(text, className = "") {
  const span = createTextElement("span", className, text);
  return span;
}

function renderSelected() {
  const video = getSelected();
  if (!video) return;

  const isFavorite = state.favorites.has(video.id);
  elements.title.textContent = video.title;
  elements.channel.textContent = video.channel;
  elements.description.textContent = video.description || "Film disponible dans le lecteur intégré.";
  elements.status.textContent = getStatusLabel(video);
  elements.status.className = `status-badge status-${video.status}`;
  elements.source.textContent = getSourceLabel(video, getPlayableSources(video)[state.playbackIndex]);
  elements.favoriteSelected.disabled = false;
  elements.favoriteSelected.classList.toggle("is-favorite", isFavorite);
  elements.favoriteSelected.querySelector("span").textContent = isFavorite ? "★" : "☆";
  elements.favoriteSelected.setAttribute(
    "aria-label",
    isFavorite ? "Retirer le film des favoris" : "Ajouter le film aux favoris",
  );

  elements.facts.replaceChildren();
  if (video.status === "upcoming" && video.scheduledStart) {
    const countdown = makeFact(formatCountdown(video.scheduledStart), "countdown");
    countdown.dataset.time = video.scheduledStart;
    elements.facts.append(countdown, makeFact(getConferenceTimingLabel(video)));
  } else {
    elements.facts.append(makeFact(getConferenceTimingLabel(video)));
  }
  elements.facts.append(makeFact(formatDuration(video.durationSeconds)));
  elements.facts.append(makeFact(video.languageLabel || "Français"));
  if (video.releaseYear) elements.facts.append(makeFact(`Sortie : ${video.releaseYear}`));
  if (video.stale) elements.facts.append(makeFact("Disponibilité à revérifier"));
  const sources = getPlayableSources(video);
  elements.playbackSource.replaceChildren(...sources.map((source, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `${i + 1}. ${getSourceLabel(video, source)}`;
    return option;
  }));
  elements.playbackSource.value = String(state.playbackIndex);
  elements.playbackSource.disabled = sources.length < 2;
  elements.credits.replaceChildren();
  const credits = video.credits?.length ? video.credits : [video];
  for (const credit of credits) {
    const row = createTextElement("p", "", [credit.attribution, credit.rights].filter(Boolean).join(" · "));
    try {
      const url = new URL(credit.sourceUrl);
      if (url.protocol === "https:" && !url.username && !url.password) {
        const link = createTextElement("a", "credit-link", "Fiche originale et informations sur la source ↗");
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        row.append(document.createTextNode(" "), link);
      }
    } catch {}
    elements.credits.append(row);
  }

  elements.topics.replaceChildren();
  (video.topics || []).slice(0, 5).forEach((topic) => {
    elements.topics.append(createTextElement("span", "selected-topic", topic));
  });
}

function createCard(video) {
  const article = document.createElement("article");
  article.className = "video-card";
  article.dataset.videoId = video.id;
  if (video.id === state.selectedId) article.classList.add("is-selected");

  const selectButton = document.createElement("button");
  selectButton.type = "button";
  selectButton.className = "video-card-select";
  selectButton.dataset.selectVideo = video.id;
  selectButton.setAttribute("aria-label", `Lire ${video.title} dans l’application`);
  if (video.id === state.selectedId) selectButton.setAttribute("aria-current", "true");

  const visual = document.createElement("span");
  visual.className = "card-visual";
  const image = document.createElement("img");
  image.src = video.thumbnail;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => {
    image.src = appUrl("icons/icon.svg");
    visual.classList.add("image-fallback");
  }, { once: true });
  const play = createTextElement("span", "card-play", "▶");
  play.setAttribute("aria-hidden", "true");
  const status = createTextElement("span", `card-status status-${video.status}`, getStatusLabel(video));
  visual.append(image, play, status);
  if (video.status === "upcoming" && video.scheduledStart) {
    const countdown = createTextElement("span", "card-countdown countdown", formatCountdown(video.scheduledStart));
    countdown.dataset.time = video.scheduledStart;
    visual.append(countdown);
  }

  const content = document.createElement("span");
  content.className = "card-content";
  const metadata = document.createElement("span");
  metadata.className = "card-metadata";
  metadata.append(
    createTextElement("span", "", video.channel),
    createTextElement("span", "", formatDuration(video.durationSeconds)),
  );
  const title = createTextElement("strong", "card-title", video.title);
  const footer = document.createElement("span");
  footer.className = "card-footer";
  footer.append(
    createTextElement(
      "span",
      "",
      getConferenceTimingLabel(video),
    ),
    createTextElement("span", "card-source", getSourceLabel(video)),
  );
  content.append(metadata, title, footer);
  selectButton.append(visual, content);

  const favorite = document.createElement("button");
  favorite.type = "button";
  favorite.className = "card-favorite";
  favorite.dataset.favoriteVideo = video.id;
  const isFavorite = state.favorites.has(video.id);
  favorite.classList.toggle("is-favorite", isFavorite);
  favorite.textContent = isFavorite ? "★" : "☆";
  favorite.setAttribute(
    "aria-label",
    isFavorite ? `Retirer ${video.title} des favoris` : `Ajouter ${video.title} aux favoris`,
  );

  article.append(selectButton, favorite);
  return article;
}

function renderCatalog() {
  const filtered = sortForDisplay(
    filterCatalog(state.videos, state.filters, state.favorites),
  );
  elements.grid.replaceChildren(...filtered.slice(0, state.visibleLimit).map(createCard));
  elements.loadMore.hidden = filtered.length <= state.visibleLimit;
  elements.loadMore.textContent = `Afficher plus de films (${Math.min(state.visibleLimit, filtered.length)} / ${filtered.length})`;
  elements.empty.querySelector("h3").textContent = "Aucun film ne correspond";
  elements.empty.querySelector("p").textContent = "Modifiez la recherche ou retirez un filtre.";
  elements.grid.setAttribute("aria-busy", "false");
  elements.grid.hidden = filtered.length === 0;
  elements.empty.hidden = filtered.length !== 0;
  elements.resultCount.textContent = String(filtered.length);
  elements.clearFilters.hidden = !hasActiveFilters();
  renderStatusTabs();
  renderTopicTabs();
}

function createQueueItem(video, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "queue-item";
  button.dataset.selectVideo = video.id;
  button.setAttribute("aria-label", `Lire ${video.title}`);
  button.append(createTextElement("span", "queue-index", String(index + 1).padStart(2, "0")));
  const body = document.createElement("span");
  body.className = "queue-body";
  body.append(
    createTextElement("strong", "", video.title),
    createTextElement(
      "small",
      video.status === "live" ? "live-copy" : "",
      video.status === "upcoming" && video.scheduledStart
        ? formatCountdown(video.scheduledStart)
        : `${video.channel} · ${formatDuration(video.durationSeconds)}`,
    ),
  );
  button.append(body, createTextElement("span", "queue-arrow", "›"));
  return button;
}

function renderQueue() {
  const queue = sortForDisplay(state.videos)
    .filter((video) => video.id !== state.selectedId)
    .slice(0, 4);
  elements.queue.replaceChildren(...queue.map(createQueueItem));
  document.querySelector("#queue-count").textContent = String(queue.length);
}

function renderStats() {
  const counts = countCatalog(state.videos);
  document.querySelector("#stat-total").textContent = String(counts.total);
  document.querySelector("#stat-live").textContent = String(state.videos.filter((v) => v.language === "fr").length);
  document.querySelector("#stat-upcoming").textContent = String(new Set(state.sources.filter((s) => s.count > 0).map((s) => s.provider)).size);
  elements.mode.textContent = state.mode === "french-multisource" ? "Catalogue français" : "Catalogue local";
  const date = state.generatedAt ? new Date(state.generatedAt) : null;
  elements.updated.textContent = date && !Number.isNaN(date.getTime())
    ? `Catalogue actualisé le ${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)}`
    : "Date d’actualisation non renseignée";
  elements.sourceHealth.replaceChildren(...state.sources.map((source) => {
    const status = source.status === "needs-review" ? "aucun film validé pour le catalogue" : source.status === "unavailable" ? "indisponible à la dernière collecte" : source.status === "partial" ? "collecte partielle" : "collecte réussie";
    return createTextElement("p", "source-health-row", `${source.name} · ${source.count || 0} vidéos retenues · ${status}`);
  }));
}

function renderAll() {
  renderStats();
  renderSelected();
  renderQueue();
  renderCatalog();
}

function selectVideo(id, { autoplay = true, scroll = true, sourceIndex = 0 } = {}) {
  const video = state.videos.find((item) => item.id === id && isPlayableMovie(item));
  if (!video) {
    showToast("Ce film n’est plus intégrable.");
    return;
  }
  state.selectedId = video.id;
  state.playbackIndex = sourceIndex;
  try { localStorage.setItem(SELECTED_KEY, video.id); } catch {}
  loadPlayer(elements.player, video, autoplay, {
    sourceIndex,
    onChange: (event) => {
      if (state.selectedId !== video.id) return;
      state.playbackIndex = event.index;
      elements.playbackSource.value = String(event.index);
      elements.source.textContent = getSourceLabel(video, event.source);
      elements.playbackNote.textContent = event.state === "error"
        ? "Lecture indisponible. Vous pouvez choisir un autre film."
        : event.state === "playing" ? "Lecture en cours dans l’application."
        : event.state === "fallback" ? "Essai d’une autre source…"
        : video.languageEvidence === "audio-track"
          ? "Choisissez la piste française dans les paramètres du lecteur si nécessaire."
          : getPlayableSources(video).length > 1
            ? "Si le lecteur signale un blocage, essayez une autre source ci-dessus."
            : "Lancez le film avec les commandes du lecteur. Une source peut devenir indisponible.";
    },
  }).catch(() => {
    showToast("Le lecteur n’a pas pu démarrer cette source.");
  });
  renderSelected();
  renderQueue();
  renderCatalog();
  if (scroll && window.matchMedia("(max-width: 780px)").matches) {
    document.querySelector(".player-frame").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function toggleFavorite(id) {
  const video = state.videos.find((item) => item.id === id);
  if (!video) return;
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
    for (const alias of video.alternateIds || []) state.favorites.delete(alias);
  } else state.favorites.add(id);
  persistFavorites();
  renderCatalog();
  renderSelected();
}

function hasActiveFilters() {
  return (
    state.filters.status !== "all" ||
    state.filters.topic !== "all" ||
    state.filters.language !== "fr" ||
    state.filters.date !== "all" ||
    state.filters.source !== "all" ||
    Boolean(state.filters.query)
  );
}

function resetFilters() {
  state.filters = {
    status: "all",
    topic: "all",
    language: "fr",
    date: "all",
    source: "all",
    query: "",
  };
  document.querySelector("#catalog-search").value = "";
  document.querySelector("#language-filter").value = "fr";
  state.visibleLimit = 48;
  document.querySelector("#date-filter").value = "all";
  document.querySelector("#source-filter").value = "all";
  renderCatalog();
}

async function requestCatalog(forceRefresh = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CATALOG_REQUEST_TIMEOUT_MS);
  try {
    const query = forceRefresh ? `?refresh=1&t=${Date.now()}` : "";
    const response = await fetch(`${CATALOG_URL}${query}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Catalogue indisponible (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function scheduleCatalogRecovery() {
  if (!navigator.onLine || catalogRecoveryTimer !== null) return;
  catalogRecoveryTimer = window.setTimeout(() => {
    catalogRecoveryTimer = null;
    loadCatalog(false, { allowFallback: false, silent: true });
  }, CATALOG_RECOVERY_DELAY_MS);
}

async function loadCatalog(
  forceRefresh = false,
  { allowFallback = true, silent = false } = {},
) {
  if (state.refreshing) return false;
  state.refreshing = true;
  elements.refresh.classList.add("is-loading");
  elements.refresh.disabled = true;
  try {
    let payload;
    let usedFallback = false;
    try {
      payload = await requestCatalog(forceRefresh);
    } catch (error) {
      if (!allowFallback) throw error;
      const fallback = await fetch(appUrl("data/seed-catalog.json"), { cache: "no-store" });
      if (!fallback.ok) throw new Error("Catalogue local indisponible");
      payload = await fallback.json();
      usedFallback = true;
      payload.notice = navigator.onLine
        ? "Le catalogue local a pris le relais. Nouvelle tentative automatique en cours."
        : "Catalogue hors connexion. La lecture des films nécessite Internet.";
    }

    const playable = Array.isArray(payload.videos)
      ? payload.videos.filter((video) => video.language === "fr" && video.durationSeconds >= 2400 && isPlayableMovie(video))
      : [];
    if (!playable.length) throw new Error("Aucun film français intégrable");
    state.videos = [...new Map(playable.map((video) => [video.id, video])).values()];
    // Les favoris restent conservés quand une source est momentanément absente.
    for (const video of state.videos) {
      if (video.alternateIds?.some((id) => state.favorites.has(id))) state.favorites.add(video.id);
    }
    persistFavorites();
    state.mode = payload.mode || "local-catalog";
    state.sources = Array.isArray(payload.sources) ? payload.sources : [];
    state.generatedAt = payload.generatedAt || null;
    state.notice = payload.notice || "";
    state.loading = false;

    let persisted = state.selectedId;
    try { persisted ||= localStorage.getItem(SELECTED_KEY); } catch {}
    const preferred = state.videos.find((video) => video.id === persisted || video.alternateIds?.includes(persisted))?.id;
    const live = state.videos.find((video) => video.status === "live")?.id;
    const nextSelection = preferred || live || sortForDisplay(state.videos)[0].id;
    const playerIsAlreadyLoaded =
      state.selectedId === nextSelection &&
      Boolean(elements.player.querySelector("iframe, video"));
    if (!playerIsAlreadyLoaded) {
      selectVideo(nextSelection, { autoplay: false, scroll: false });
    }
    renderAll();
    if (usedFallback) scheduleCatalogRecovery();
    else if (catalogRecoveryTimer !== null) {
      window.clearTimeout(catalogRecoveryTimer);
      catalogRecoveryTimer = null;
    }
    if (forceRefresh) showToast("Dernier catalogue disponible rechargé.");
    else if (state.notice) showToast(state.notice);
    return !usedFallback;
  } catch (error) {
    if (state.videos.length) { if (!silent) showToast("Actualisation indisponible. Le catalogue actuel reste accessible."); return false; }
    elements.grid.setAttribute("aria-busy", "false");
    elements.grid.replaceChildren();
    elements.loadMore.hidden = true;
    elements.grid.hidden = true;
    elements.empty.hidden = false;
    elements.empty.querySelector("h3").textContent = "Catalogue momentanément indisponible";
    elements.empty.querySelector("p").textContent = "Une nouvelle tentative sera possible dans un instant.";
    showToast(error instanceof Error ? error.message : "Impossible de charger le catalogue.");
    return false;
  } finally {
    state.refreshing = false;
    elements.refresh.classList.remove("is-loading");
    elements.refresh.disabled = false;
  }
}

function updateCountdowns() {
  document.querySelectorAll(".countdown[data-time]").forEach((element) => {
    element.textContent = formatCountdown(element.dataset.time);
  });
}

function updateNetworkState() {
  const online = navigator.onLine;
  elements.network.classList.toggle("is-offline", !online);
  elements.network.querySelector("span").textContent = online ? "Connexion active" : "Mode hors connexion";
  if (online) scheduleCatalogRecovery();
}

elements.statusTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (!button) return;
  state.filters.status = button.dataset.status;
  state.visibleLimit = 48;
  renderCatalog();
});

elements.topicTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-topic]");
  if (!button) return;
  state.filters.topic = button.dataset.topic;
  state.visibleLimit = 48;
  renderCatalog();
});

document.addEventListener("click", (event) => {
  const select = event.target.closest("[data-select-video]");
  if (select) selectVideo(select.dataset.selectVideo);
  const favorite = event.target.closest("[data-favorite-video]");
  if (favorite) toggleFavorite(favorite.dataset.favoriteVideo);
});

elements.favoriteSelected.addEventListener("click", () => {
  if (state.selectedId) toggleFavorite(state.selectedId);
});

elements.refresh.addEventListener("click", () => loadCatalog(true));
elements.loadMore.addEventListener("click", () => { state.visibleLimit += 48; renderCatalog(); });
elements.playbackSource.addEventListener("change", (event) => {
  if (state.selectedId) selectVideo(state.selectedId, { sourceIndex: Number(event.target.value), scroll: false });
});
document.querySelector("#fullscreen-player").addEventListener("click", () => {
  requestPlayerFullscreen(elements.player).then((ok) => { if (!ok) showToast("Utilisez le bouton plein écran du lecteur."); }).catch(() => showToast("Plein écran non disponible sur cet appareil."));
});
elements.clearFilters.addEventListener("click", resetFilters);
elements.empty.querySelector("button").addEventListener("click", () => { if (state.videos.length) resetFilters(); else loadCatalog(true); });

document.querySelector("#catalog-search").addEventListener("input", (event) => {
  state.filters.query = event.target.value;
  state.visibleLimit = 48;
  renderCatalog();
});
document.querySelector("#language-filter").addEventListener("change", (event) => {
  state.filters.language = event.target.value;
  state.visibleLimit = 48;
  renderCatalog();
});
document.querySelector("#date-filter").addEventListener("change", (event) => {
  state.filters.date = event.target.value;
  state.visibleLimit = 48;
  renderCatalog();
});
document.querySelector("#source-filter").addEventListener("change", (event) => {
  state.filters.source = event.target.value;
  state.visibleLimit = 48;
  renderCatalog();
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("#catalog-search").focus();
  }
});

window.addEventListener("online", updateNetworkState);
window.addEventListener("offline", updateNetworkState);
updateNetworkState();

let installPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  elements.install.hidden = false;
});
elements.install.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  elements.install.hidden = true;
});
window.addEventListener("appinstalled", () => showToast("CR3@TIX MOVIES est installée."));

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(appUrl("service-worker.js"), {
        scope: APP_BASE_URL,
      });
      registration.update();
    } catch {
      showToast("Installation PWA temporairement indisponible.");
    }
  });
}

setInterval(updateCountdowns, 30_000);
renderStatusTabs();
renderTopicTabs();
loadCatalog();
