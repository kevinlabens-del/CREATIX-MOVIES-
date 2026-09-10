import { loadPlayer } from './player.js';
import { formatDuration, isPlayableMovie } from './catalog.js';

const app = document.querySelector('#series-app');
const catalogUrl = new URL('./data/catalog.json', document.baseURI).href;
const movieUrl = new URL('./', document.baseURI).href;

const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const episodeNumber = (video) => Number(video.episodeNumber) || Number(String(video.title || '').match(/(?:épisode|episode|ep\.?|e)\s*(\d{1,3})/i)?.[1]) || 0;
const seasonNumber = (video) => Number(video.seasonNumber) || Number(String(video.title || '').match(/(?:saison|season|s)\s*(\d{1,2})/i)?.[1]) || 1;
const seriesName = (video) => video.seriesTitle || String(video.title || '').replace(/(?:[-–—|:]?\s*(?:saison|season|s)\s*\d{1,2})?.*?(?:épisode|episode|ep\.?|e)\s*\d{1,3}.*$/i, '').trim() || 'Série';

app.innerHTML = `
  <div class="series-shell">
    <header class="series-header">
      <div>
        <p class="eyebrow">CR3@TIX MOVIES</p>
        <h1>Séries</h1>
        <p class="subtitle">Séries en français · saisons et épisodes regroupés · lecture intégrée</p>
      </div>
      <nav class="mode-switch" aria-label="Choisir le catalogue">
        <a href="${movieUrl}">🎬 Films</a>
        <a class="active" href="./series.html" aria-current="page">📺 Séries</a>
      </nav>
    </header>

    <section class="series-player-wrap" hidden>
      <div id="series-player" class="series-player"></div>
      <div class="series-now">
        <span id="series-now-label">Lecture</span>
        <h2 id="series-now-title"></h2>
        <p id="series-now-meta"></p>
      </div>
    </section>

    <section class="series-toolbar">
      <label>
        <span class="sr-only">Rechercher une série</span>
        <input id="series-search" type="search" placeholder="Rechercher une série ou un épisode…" autocomplete="off" />
      </label>
      <div class="series-stats"><strong id="series-count">0</strong> séries · <strong id="episode-count">0</strong> épisodes</div>
    </section>

    <section id="series-list" class="series-list" aria-live="polite">
      <p class="loading">Chargement des séries…</p>
    </section>
  </div>`;

const list = document.querySelector('#series-list');
const search = document.querySelector('#series-search');
const playerWrap = document.querySelector('.series-player-wrap');
const player = document.querySelector('#series-player');
const nowTitle = document.querySelector('#series-now-title');
const nowMeta = document.querySelector('#series-now-meta');
let episodes = [];

function groupEpisodes(rows) {
  const groups = new Map();
  for (const video of rows) {
    const title = seriesName(video);
    const key = title.toLocaleLowerCase('fr');
    if (!groups.has(key)) groups.set(key, { title, seasons: new Map(), thumbnail: video.thumbnail || '' });
    const group = groups.get(key);
    const season = seasonNumber(video);
    if (!group.seasons.has(season)) group.seasons.set(season, []);
    group.seasons.get(season).push(video);
  }
  for (const group of groups.values()) {
    for (const rows of group.seasons.values()) rows.sort((a,b) => episodeNumber(a) - episodeNumber(b) || String(a.title).localeCompare(String(b.title), 'fr'));
  }
  return [...groups.values()].sort((a,b) => a.title.localeCompare(b.title, 'fr'));
}

function render() {
  const q = search.value.trim().toLocaleLowerCase('fr');
  const filtered = q ? episodes.filter((video) => `${seriesName(video)} ${video.title} ${video.description || ''}`.toLocaleLowerCase('fr').includes(q)) : episodes;
  const groups = groupEpisodes(filtered);
  document.querySelector('#series-count').textContent = String(groups.length);
  document.querySelector('#episode-count').textContent = String(filtered.length);

  if (!groups.length) {
    list.innerHTML = `<div class="empty"><h2>Aucune série trouvée</h2><p>Essaie une autre recherche ou actualise le catalogue.</p></div>`;
    return;
  }

  list.innerHTML = groups.map((group, index) => {
    const seasons = [...group.seasons.entries()].sort((a,b) => a[0]-b[0]);
    const episodeTotal = seasons.reduce((n,[,rows]) => n + rows.length, 0);
    return `<article class="series-card">
      <button class="series-head" type="button" data-toggle-series="${index}" aria-expanded="${index === 0 ? 'true' : 'false'}">
        <img src="${esc(group.thumbnail)}" alt="" loading="lazy" />
        <span><strong>${esc(group.title)}</strong><small>${seasons.length} saison${seasons.length>1?'s':''} · ${episodeTotal} épisode${episodeTotal>1?'s':''}</small></span>
        <b>⌄</b>
      </button>
      <div class="season-stack" data-series-panel="${index}" ${index === 0 ? '' : 'hidden'}>
        ${seasons.map(([season, rows]) => `<details class="season" ${seasons.length === 1 ? 'open' : ''}>
          <summary>Saison ${season} <span>${rows.length} épisode${rows.length>1?'s':''}</span></summary>
          <div class="episode-list">
            ${rows.map((video, pos) => `<button class="episode-row" type="button" data-play-id="${esc(video.id)}">
              <span class="episode-number">${episodeNumber(video) || pos + 1}</span>
              <span class="episode-copy"><strong>${esc(video.title)}</strong><small>${formatDuration(video.durationSeconds)} · ${esc(video.channel || '')}</small></span>
              <span class="episode-play">▶</span>
            </button>`).join('')}
          </div>
        </details>`).join('')}
      </div>
    </article>`;
  }).join('');
}

async function playEpisode(id) {
  const video = episodes.find((item) => item.id === id);
  if (!video) return;
  playerWrap.hidden = false;
  nowTitle.textContent = video.title;
  nowMeta.textContent = `${seriesName(video)} · Saison ${seasonNumber(video)} · Épisode ${episodeNumber(video) || '—'} · ${formatDuration(video.durationSeconds)}`;
  await loadPlayer(player, video, true).catch(() => {});
  playerWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

list.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-toggle-series]');
  if (toggle) {
    const panel = list.querySelector(`[data-series-panel="${toggle.dataset.toggleSeries}"]`);
    const opening = panel.hidden;
    panel.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    return;
  }
  const play = event.target.closest('[data-play-id]');
  if (play) playEpisode(play.dataset.playId);
});
search.addEventListener('input', render);

async function load() {
  try {
    const response = await fetch(`${catalogUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Catalogue indisponible');
    const payload = await response.json();
    episodes = (payload.videos || []).filter((video) => video.language === 'fr' && video.contentType === 'episode' && video.durationSeconds >= 480 && isPlayableMovie(video));
    render();
  } catch {
    list.innerHTML = `<div class="empty"><h2>Catalogue séries indisponible</h2><p>La prochaine collecte réessaiera automatiquement.</p></div>`;
  }
}

load();
