const KEY = 'creatix-movies:manual-videos:v1';
const originalFetch = window.fetch.bind(window);

function readManual() {
  try {
    const rows = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

window.fetch = async (input, init) => {
  const response = await originalFetch(input, init);
  try {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!/\/data\/catalog\.json(?:[?#]|$)/.test(url)) return response;
    const payload = await response.clone().json();
    const manual = readManual();
    if (!manual.length) return response;
    const existing = new Set((payload.videos || []).map(v => v.id));
    payload.videos = [...(payload.videos || []), ...manual.filter(v => !existing.has(v.id))];
    payload.notice = `${payload.notice || ''} · ${manual.length} ajout${manual.length > 1 ? 's' : ''} manuel${manual.length > 1 ? 's' : ''}`.trim();
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch { return response; }
};
