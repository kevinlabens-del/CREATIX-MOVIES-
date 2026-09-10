import {config,clean,isFeature,topicsFor,request} from './catalog-utils.mjs';

function text(xml,tag){const m=String(xml||'').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,'i'));return clean((m?.[1]||'').replace(/<[^>]+>/g,' '));}
function texts(xml,tag){return [...String(xml||'').matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,'gi'))].map(m=>clean(m[1].replace(/<[^>]+>/g,' '))).filter(Boolean);}
function arkFrom(value){return String(value||'').match(/ark:\/12148\/([A-Za-z0-9]+)|gallica\.bnf\.fr\/ark:\/12148\/([A-Za-z0-9]+)/)?.slice(1).find(Boolean)||null;}
function durationFrom(xml){for(const value of [...texts(xml,'dc:format'),...texts(xml,'dc:description')]){const h=value.match(/(\d{1,2})\s*h(?:eures?)?\s*(\d{1,2})?\s*(?:min|mn)?/i);if(h)return Number(h[1])*3600+Number(h[2]||0)*60;const m=value.match(/(?:dur[eé]e\s*[:：-]?\s*)?(\d{2,3})\s*(?:min|mn)\b/i);if(m)return Number(m[1])*60;const tc=value.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/);if(tc)return Number(tc[1])*3600+Number(tc[2])*60+Number(tc[3]);}return null;}
function french(xml){return texts(xml,'dc:language').some(v=>/^(?:fr|fre|fra|fran[cç]ais)$/i.test(v)||/fran[cç]ais/i.test(v));}

export function normalizeGallica(xml,now=new Date()){
  if(!xml||!french(xml))return null;
  const identifier=texts(xml,'dc:identifier').map(arkFrom).find(Boolean)||arkFrom(xml);if(!identifier)return null;
  const video=String(xml).match(/<video>[\s\S]*?<file>(https:\/\/gallica\.bnf\.fr\/[^<]+\.mp4)<\/file>[\s\S]*?<\/video>/i)?.[1];if(!video)return null;
  const title=text(xml,'dc:title');const durationSeconds=durationFrom(xml);if(!title||!isFeature(title,durationSeconds,{trustedFilmCatalog:true}))return null;
  const rights=text(xml,'dc:rights');const access=text(xml,'visibility_rights');if(access&&access!=='all')return null;
  const creators=texts(xml,'dc:creator');const subjects=texts(xml,'dc:subject');const date=text(xml,'dc:date');
  return {id:`gallica:${identifier}`,source:'mp4',provider:'gallica',title,channel:'Gallica · BnF',description:text(xml,'dc:description').slice(0,420),thumbnail:`https://gallica.bnf.fr/ark:/12148/${identifier}/thumbnail`,publishedAt:null,releaseYear:Number(date.match(/\b(18|19|20)\d{2}\b/)?.[0])||null,durationSeconds,status:'replay',language:'fr',languageLabel:'Français · Gallica',languageEvidence:'publisher-metadata',topics:topicsFor(`${subjects.join(' ')} ${title}`),score:72,embeddable:true,rights:rights||'Document Gallica en accès libre',rightsUrl:`https://gallica.bnf.fr/html/und/conditions-dutilisation-des-contenus-de-gallica`,attribution:creators.join(', '),sourceUrl:`https://gallica.bnf.fr/ark:/12148/${identifier}`,lastCheckedAt:now.toISOString(),verification:'bnf-oai-metadata',playbackSources:[{source:'mp4',playbackUrl:video,embeddable:true,label:'Gallica · vidéo directe'}]};
}

export async function discoverFrenchGallica({existing=[],fetchImpl=fetch,now=new Date()}={}){
  if(config.gallica===false)return {videos:[],removed:[],reports:[]};
  const ids=new Set(),videos=[];let failed=0,scanned=0;
  try{
    const pages=Math.max(1,Math.min(Number(config.gallicaSearchPages)||20,100));
    for(let page=0;page<pages;page++){
      const u=new URL('https://gallica.bnf.fr/SRU');u.searchParams.set('version','1.2');u.searchParams.set('operation','searchRetrieve');u.searchParams.set('maximumRecords','50');u.searchParams.set('startRecord',String(page*50+1));u.searchParams.set('collapsing','false');u.searchParams.set('query','dc.type any "video" and access any "fayes"');
      const xml=await request(u,{fetchImpl,timeout:20000});const records=String(xml).split(/<srw:record>/i).slice(1);if(!records.length)break;
      for(const record of records){for(const value of texts(record,'dc:identifier')){const ark=arkFrom(value);if(ark)ids.add(ark);}}scanned+=records.length;if(records.length<50)break;
    }
  }catch{failed++;}
  const previous=new Map(existing.filter(v=>v.provider==='gallica').map(v=>[v.id,v]));
  const list=[...ids];for(let i=0;i<list.length;i+=6){await Promise.all(list.slice(i,i+6).map(async id=>{try{const xml=await request(`https://gallica.bnf.fr/services/OAIRecord?ark=${encodeURIComponent(id)}`,{fetchImpl,timeout:20000});const video=normalizeGallica(xml,now);if(video)videos.push(video);}catch{failed++;}}));}
  if(failed)for(const old of previous.values())if(!videos.some(v=>v.id===old.id))videos.push({...old,stale:true});
  return {videos,removed:[],reports:[{id:'gallica',provider:'gallica',name:'Gallica · BnF',status:failed?(videos.length?'partial':'unavailable'):'ok',count:videos.length,discovered:scanned,...(!failed?{lastSuccessAt:now.toISOString()}:{})}]};
}
