import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config,mergeMovies} from './catalog-utils.mjs';
import {discoverFrenchYouTube} from './youtube-french.mjs';
import {discoverFrenchDailymotion} from './dailymotion-french.mjs';
import {discoverFrenchOnf} from './onf-french.mjs';
import {discoverFrenchArchive as discoverArchiveCatalog} from './archive-french.mjs';
import {discoverFrenchCommons} from './wikimedia-french.mjs';
import {discoverFrenchGallica} from './gallica-french.mjs';
import {discoverFrenchEuropeana} from './europeana-french.mjs';
import {discoverCustomJsonFeeds} from './custom-json-feeds.mjs';

const root=new URL('../',import.meta.url);
async function readJson(path,fallback){try{return JSON.parse(await readFile(new URL(path,root),'utf8'));}catch{return fallback;}}
const previous=await readJson('public/data/catalog.json',await readJson('public/data/seed-catalog.json',{videos:[]}));
const sourceState=await readJson('data/source-catalog.json',previous);
const now=new Date();
const hasCustomFeeds=Array.isArray(config.customJsonFeeds)&&config.customJsonFeeds.some(source=>source?.enabled!==false);
const jobs=[
  ['youtube',discoverFrenchYouTube],
  ['dailymotion',discoverFrenchDailymotion],
  ...(config.onf?[['onf',discoverFrenchOnf]]:[]),
  ['archive',discoverArchiveCatalog],
  ...(config.wikimedia?[['wikimedia',discoverFrenchCommons]]:[]),
  ...(config.gallica?[['gallica',discoverFrenchGallica]]:[]),
  ...(config.europeana?[['europeana',discoverFrenchEuropeana]]:[]),
  ...(hasCustomFeeds?[['custom',discoverCustomJsonFeeds]]:[])
];
const results=await Promise.allSettled(jobs.map(async([name,run])=>{
  let result;
  if(process.env.CATALOG_CACHE_ONLY==='1') {
    result=await readJson(`.cache/${name}.json`,null);
    if(!result)throw new Error(`Collecte manquante : ${name}`);
  }else result=await run({existing:sourceState.videos,now});
  console.log(`${name}: ${result.videos.length} films français retenus`);
  return result;
}));
const reports=[],movies=[],removed=new Set();
for(let i=0;i<results.length;i++) {
  const result=results[i],name=jobs[i][0];
  if(result.status==='fulfilled') {
    movies.push(...result.value.videos);reports.push(...result.value.reports);
    for(const id of result.value.removed||[])removed.add(id);
  }else {
    reports.push({id:name,provider:name,name,status:'unavailable',count:0});
    movies.push(...sourceState.videos.filter(v=>(v.provider||v.source)===name).map(v=>({...v,stale:true})));
  }
}
for(const movie of movies) {
  movie.playbackSources=(movie.playbackSources||[]).filter(s=>!removed.has(`${s.source}:${s.videoId||s.identifier}`));
}
const approvedMovies=movies.filter(v=>v.source!=="archive"||config.archiveAutoDiscovery||config.archiveApprovedIdentifiers.includes(v.identifier));
const videos=mergeMovies(approvedMovies.filter(v=>!removed.has(v.id)&&v.playbackSources.length)).sort((a,b)=>(b.score||0)-(a.score||0)||String(b.publishedAt||'').localeCompare(String(a.publishedAt||'')));
if(!videos.length)throw new Error('Aucun film français conservé : le dernier catalogue reste inchangé.');
const active=reports.filter(r=>r.count>0).length;
const payload={version:9,appVersion:'2.1.0-collector',mode:'french-multisource-v2-max',generatedAt:reports.some(r=>r.lastSuccessAt)?now.toISOString():(previous.generatedAt||null),lastAttemptAt:now.toISOString(),videos,sources:reports,
  notice:`${videos.length} films complets en français · ${active} catalogues contributeurs.`,
  selection:{language:'fr',minimumDurationSeconds:config.minimumDurationSeconds,region:'FR',verification:'V2 MAX : collecte multi-source élargie, lecture intégrable, durée minimale, français et droits compatibles vérifiés selon les métadonnées disponibles.'}};
for(const path of ['public/data/catalog.json','data/catalog.json']) {
  const target=new URL(path,root);await mkdir(dirname(fileURLToPath(target)),{recursive:true});
  const temp=new URL(path+'.tmp',root);await writeFile(temp,JSON.stringify(payload,null,2)+'\n');await rename(temp,target);
}
await writeFile(new URL('data/source-catalog.json',root),JSON.stringify({videos:approvedMovies},null,2)+'\n');
console.log(`Catalogue V2 MAX préparé : ${videos.length} films complets en français, doublons regroupés.`);
