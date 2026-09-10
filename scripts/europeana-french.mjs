import {config,clean,isFeature,topicsFor,request} from './catalog-utils.mjs';

function arr(v){return Array.isArray(v)?v:(v==null?[]:[v]);}
function first(v){return clean(arr(v)[0]||'');}
function durationFrom(item){for(const value of [...arr(item.dcDescription),...arr(item.edmTimespanLabel),...arr(item.dctermsExtent)]){const s=String(value);const tc=s.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/);if(tc)return Number(tc[1])*3600+Number(tc[2])*60+Number(tc[3]);const h=s.match(/(\d{1,2})\s*h(?:eures?)?\s*(\d{1,2})?\s*(?:min|mn)?/i);if(h)return Number(h[1])*3600+Number(h[2]||0)*60;const m=s.match(/(?:dur[eé]e\s*[:：-]?\s*)?(\d{2,3})\s*(?:min|mn)\b/i);if(m)return Number(m[1])*60;}return null;}
function isFrench(item){return arr(item.dcLanguage).some(v=>/^(?:fr|fre|fra)$/i.test(String(v))||/fran[cç]ais/i.test(String(v)));}
function directVideo(item){for(const value of [...arr(item.edmIsShownBy),...arr(item.edmHasView)]){try{const u=new URL(String(value));if(u.protocol!=='https:')continue;if(/\.mp4(?:$|\?)/i.test(u.href))return {source:'mp4',url:u.href};if(/\.webm(?:$|\?)/i.test(u.href))return {source:'webm',url:u.href};if(/\.m3u8(?:$|\?)/i.test(u.href))return {source:'hls',url:u.href};}catch{}}return null;}

export function normalizeEuropeana(item,now=new Date()){
  if(!item||!isFrench(item))return null;
  const video=directVideo(item);if(!video)return null;
  const title=first(item.title||item.dcTitle);const durationSeconds=durationFrom(item);if(!title||!isFeature(title,durationSeconds,{trustedFilmCatalog:true}))return null;
  const id=String(item.id||'').replace(/^\//,'').replace(/[^A-Za-z0-9_/-]/g,'');if(!id)return null;
  const rights=first(item.rights);const year=Number(first(item.year).match(/\b(18|19|20)\d{2}\b/)?.[0])||null;
  return {id:`europeana:${id.replace(/\//g,':')}`,source:video.source,provider:'europeana',title,channel:first(item.dataProvider||item.provider)||'Europeana',description:first(item.dcDescription).slice(0,420),thumbnail:first(item.edmPreview)||'',publishedAt:null,releaseYear:year,durationSeconds,status:'replay',language:'fr',languageLabel:'Français · Europeana',languageEvidence:'publisher-metadata',topics:topicsFor(`${arr(item.dcSubject).join(' ')} ${title}`),score:66,embeddable:true,rights:rights||'Licence ouverte indiquée par Europeana',rightsUrl:rights&&/^https:\/\//.test(rights)?rights:null,attribution:first(item.dcCreator),sourceUrl:first(item.edmIsShownAt),lastCheckedAt:now.toISOString(),verification:'europeana-open-media',playbackSources:[{source:video.source,playbackUrl:video.url,embeddable:true,label:'Europeana · média ouvert'}]};
}

export async function discoverFrenchEuropeana({existing=[],fetchImpl=fetch,now=new Date()}={}){
  if(config.europeana===false)return {videos:[],removed:[],reports:[]};
  const key=process.env.EUROPEANA_API_KEY||process.env.EUROPEANA_WSKEY;if(!key)return {videos:existing.filter(v=>v.provider==='europeana').map(v=>({...v,stale:true})),removed:[],reports:[{id:'europeana',provider:'europeana',name:'Europeana',status:'needs-key',count:0,note:'Clé EUROPEANA_API_KEY requise'}]};
  const videos=[];let cursor='*',failed=0,discovered=0;const pages=Math.max(1,Math.min(Number(config.europeanaSearchPages)||20,100));
  try{for(let page=0;page<pages;page++){
    const u=new URL('https://api.europeana.eu/record/v2/search.json');u.searchParams.set('wskey',key);u.searchParams.set('query','TYPE:VIDEO');u.searchParams.set('qf','LANGUAGE:fr');u.searchParams.set('media','true');u.searchParams.set('reusability','open');u.searchParams.set('profile','rich');u.searchParams.set('rows','100');u.searchParams.set('cursor',cursor);
    const data=await request(u,{json:true,fetchImpl,timeout:25000});const items=arr(data.items);discovered+=items.length;for(const item of items){const video=normalizeEuropeana(item,now);if(video)videos.push(video);}if(!data.nextCursor||data.nextCursor===cursor||!items.length)break;cursor=data.nextCursor;
  }}catch{failed++;}
  if(failed)for(const old of existing.filter(v=>v.provider==='europeana'))if(!videos.some(v=>v.id===old.id))videos.push({...old,stale:true});
  return {videos,removed:[],reports:[{id:'europeana',provider:'europeana',name:'Europeana',status:failed?(videos.length?'partial':'unavailable'):'ok',count:videos.length,discovered,...(!failed?{lastSuccessAt:now.toISOString()}:{})}]};
}
