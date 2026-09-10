const VIDEO_KEY='creatix-movies:manual-videos:v1';
const PASS_KEY='creatix-movies:settings-pass:v1';
const lockCard=document.querySelector('#lock-card');
const admin=document.querySelector('#admin');
const lockForm=document.querySelector('#lock-form');
const passInput=document.querySelector('#password');
const help=document.querySelector('#lock-help');
const lockTitle=document.querySelector('#lock-title');
const sourceForm=document.querySelector('#source-form');
const typeSelect=document.querySelector('#content-type');
const seriesFields=document.querySelector('#series-fields');
const list=document.querySelector('#manual-list');
const message=document.querySelector('#message');

const enc=new TextEncoder();
async function hash(value){const buf=await crypto.subtle.digest('SHA-256',enc.encode(value));return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function readVideos(){try{const v=JSON.parse(localStorage.getItem(VIDEO_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return[]}}
function saveVideos(v){localStorage.setItem(VIDEO_KEY,JSON.stringify(v));}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function updateLockCopy(){const exists=Boolean(localStorage.getItem(PASS_KEY));lockTitle.textContent=exists?'Accès protégé':'Créer le code d’accès';help.textContent=exists?'Entre ton code pour gérer tes sources manuelles.':'Choisis un code. Il protégera uniquement cette page sur cet appareil.';lockForm.querySelector('button').textContent=exists?'Déverrouiller':'Créer le code';}
function unlock(){lockCard.hidden=true;admin.hidden=false;renderList();}
function lock(){admin.hidden=true;lockCard.hidden=false;passInput.value='';updateLockCopy();}
lockForm.addEventListener('submit',async e=>{e.preventDefault();const value=passInput.value.trim();if(value.length<4){help.textContent='Utilise au moins 4 caractères.';return;}const digest=await hash(value);const current=localStorage.getItem(PASS_KEY);if(!current){localStorage.setItem(PASS_KEY,digest);unlock();return;}if(digest===current)unlock();else help.textContent='Code incorrect.';});

typeSelect.addEventListener('change',()=>{seriesFields.hidden=typeSelect.value!=='episode';});
function parsePlayback(url){const u=new URL(url);const host=u.hostname.replace(/^www\./,'');
  if(host.includes('youtube.com')||host==='youtu.be'){const id=host==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v');if(!id)throw new Error('Lien YouTube invalide');return {source:'youtube',videoId:id,embeddable:true,label:'YouTube · ajout manuel'};}
  if(host.includes('dailymotion.com')||host==='dai.ly'){const id=host==='dai.ly'?u.pathname.slice(1):u.pathname.split('/').filter(Boolean).pop();if(!id)throw new Error('Lien Dailymotion invalide');return {source:'dailymotion',videoId:id,embeddable:true,label:'Dailymotion · ajout manuel'};}
  if(host.includes('vimeo.com')){const id=u.pathname.split('/').filter(Boolean).pop();if(!/^\d+$/.test(id||''))throw new Error('Lien Vimeo invalide');return {source:'vimeo',videoId:id,embeddable:true,label:'Vimeo · ajout manuel'};}
  if(host==='archive.org'){const parts=u.pathname.split('/').filter(Boolean);const i=parts.indexOf('details');const id=i>=0?parts[i+1]:null;if(!id)throw new Error('Lien Archive invalide');return {source:'archive',videoId:id,embeddable:true,label:'Internet Archive · ajout manuel'};}
  if(/\.m3u8(?:$|\?)/i.test(url))return {source:'hls',playbackUrl:url,embeddable:true,label:'HLS · ajout manuel'};
  if(/\.webm(?:$|\?)/i.test(url))return {source:'webm',playbackUrl:url,embeddable:true,label:'WebM · ajout manuel'};
  if(/\.mp4(?:$|\?)/i.test(url))return {source:'mp4',playbackUrl:url,embeddable:true,label:'MP4 · ajout manuel'};
  throw new Error('Source non reconnue. Utilise YouTube, Dailymotion, Vimeo, Archive, MP4, WebM ou HLS.');
}
sourceForm.addEventListener('submit',e=>{e.preventDefault();message.textContent='';try{const title=document.querySelector('#title').value.trim();const url=document.querySelector('#url').value.trim();const genre=document.querySelector('#genre').value.trim();const duration=Math.max(60,Number(document.querySelector('#duration').value||0)*60);const contentType=typeSelect.value;const playback=parsePlayback(url);const now=new Date().toISOString();const item={id:`manual:${Date.now()}:${Math.random().toString(36).slice(2,8)}`,source:'manual',title,channel:'Ajout manuel',description:'Source ajoutée manuellement dans CR3@TIX MOVIES.',thumbnail:'',status:'replay',durationSeconds:duration,contentType,language:'fr',languageLabel:'Français · ajout manuel',languageEvidence:'manual',topics:genre?[genre]:[],score:100,embeddable:true,sourceUrl:url,rights:'Source ajoutée manuellement par l’utilisateur',lastCheckedAt:now,verification:'manual',playbackSources:[playback]};if(contentType==='episode'){item.seriesTitle=document.querySelector('#series-title').value.trim()||title;item.seasonNumber=Math.max(1,Number(document.querySelector('#season').value||1));item.episodeNumber=Math.max(1,Number(document.querySelector('#episode').value||1));item.topics=[...new Set(['Série',...item.topics])];}const rows=readVideos();rows.push(item);saveVideos(rows);sourceForm.reset();document.querySelector('#duration').value='45';document.querySelector('#season').value='1';document.querySelector('#episode').value='1';typeSelect.value='film';seriesFields.hidden=true;message.textContent='Ajout enregistré sur cet appareil.';renderList();}catch(err){message.textContent=err.message;}});
function renderList(){const rows=readVideos();if(!rows.length){list.innerHTML='<p class="empty">Aucun ajout manuel.</p>';return;}list.innerHTML=rows.map(v=>`<div class="manual-row"><div><strong>${esc(v.title)}</strong><small>${v.contentType==='episode'?'Série':'Film'}${v.topics?.length?' · '+esc(v.topics.join(', ')):''}</small></div><button type="button" data-delete="${esc(v.id)}">Supprimer</button></div>`).join('');}
list.addEventListener('click',e=>{const b=e.target.closest('[data-delete]');if(!b)return;saveVideos(readVideos().filter(v=>v.id!==b.dataset.delete));renderList();});
document.querySelector('#lock-now').addEventListener('click',lock);
updateLockCopy();
