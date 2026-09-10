import {request,clean,isFeature,topicsFor,mapLimit,fold} from "./catalog-utils.mjs";

function seriesParentFor(row) {
  return (row?.part_of || []).find(p=>p?.category==="series") || null;
}
function numberFrom(value,patterns) {
  const text=clean(value||"");
  for(const pattern of patterns){const m=text.match(pattern);if(m)return Number(m[m.length-1])||null;}
  return null;
}
function seriesMeta(row) {
  const parent=seriesParentFor(row);if(!parent)return null;
  const parentTitle=clean(parent.title||parent.name||parent.label||parent.slug||"Série ONF").replace(/[-_]+/g," ");
  const seasonNumber=Number(row.season_number||row.season||parent.season_number)||numberFrom(row.title,[/\bS(\d{1,2})E\d{1,3}\b/i,/(?:saison|season)\s*(\d{1,2})/i])||1;
  const episodeNumber=Number(row.episode_number||row.episode)||numberFrom(row.title,[/\bS\d{1,2}E(\d{1,3})\b/i,/(?:épisode|episode|ep\.?)\s*(\d{1,3})/i,/\b(\d{1,3})\s*[-–—:]\s*/])||null;
  return {seriesTitle:parentTitle,seasonNumber,episodeNumber};
}

export function onfEligible(row) {
  return row?.category === "film" && row.availability?.is_public === true && row.geoblocked === false &&
    !row.coming_soon && !seriesParentFor(row) &&
    isFeature(row.title,Number(row.duration),{trustedFilmCatalog:true}) &&
    !/sans paroles|sans dialogue|silent film|no dialogue/i.test(row.description || "");
}
export function onfEpisodeEligible(row) {
  return row?.category === "film" && row.availability?.is_public === true && row.geoblocked === false &&
    !row.coming_soon && Boolean(seriesParentFor(row)) &&
    isFeature(row.title,Number(row.duration),{trustedFilmCatalog:true,allowEpisode:true}) &&
    !/sans paroles|sans dialogue|silent film|no dialogue/i.test(row.description || "");
}

function promoteCachedEpisode(old,row,now=new Date()) {
  const meta=seriesMeta(row);if(!meta)return old;
  return {...old,
    title:clean(row.title||old.title),description:clean(row.description||old.description).slice(0,420),
    durationSeconds:Number(row.duration)||old.durationSeconds,releaseYear:row.year||old.releaseYear||null,
    contentType:"episode",...meta,
    topics:[...new Set(["Série",...(old.topics||[]).filter(t=>t!=="Film")])],score:Math.max(Number(old.score)||0,73),
    sourceUrl:row.availability?.resource_url||old.sourceUrl,lastCheckedAt:now.toISOString(),stale:false
  };
}

export function parseOnfPage(html,row,now=new Date()) {
  let metadata;
  for(const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const value=JSON.parse(match[1]);if(value.embedUrl)metadata=value; }catch{}
  }
  if(!metadata||!/^https:\/\/www\.onf\.ca\/film\/[\w-]+\/embed\/player\/$/.test(metadata.embedUrl))return null;
  const language=html.match(/['"]nfb_version_lang['"]\s*:\s*['"]([^'"]+)['"]/i)?.[1];
  if(language&&!/^fr(?:[-_]|$)|^(?:fre|fra|french)$/i.test(language))return null;
  const image=Array.isArray(metadata.thumbnailUrl)?metadata.thumbnailUrl[0]:metadata.thumbnailUrl;
  const creators=(metadata.director||[]).map(x=>x.name).filter(Boolean).join(", ");
  const documentary=(row.genres||[]).some(g=>fold(typeof g==='object'?g.name:g).includes('documentaire'));
  const episode=seriesMeta(row);
  const topics=topicsFor(`${row.title} ${(row.genres||[]).map(g=>typeof g==='object'?g.name:g).join(' ')}`,documentary);
  if(episode)topics.unshift('Série');
  return {
    id:`onf:${row.slug}`,source:"onf",videoId:row.slug,title:clean(row.title),channel:"Office national du film du Canada",
    description:clean(metadata.description||row.description).slice(0,420),thumbnail:image||"",
    durationSeconds:Number(row.duration),releaseYear:row.year||null,publishedAt:metadata.uploadDate||null,status:"replay",
    contentType:episode?"episode":"film",...(episode||{}),
    language:"fr",languageLabel:"Français · ONF",languageEvidence:language?"publisher-audio":"publisher-language-filter",
    topics:[...new Set(topics)],score:episode?73:75,embeddable:true,sourceUrl:row.availability.resource_url,
    rights:"© ONF · incorporation personnelle et non commerciale",rightsUrl:"https://aide.onf.ca/conditions/",attribution:creators?`${creators} · © ONF`:"© ONF",
    lastCheckedAt:now.toISOString(),verification:"publisher-metadata",
    playbackSources:[{source:"onf",videoId:row.slug,playbackUrl:metadata.embedUrl,embeddable:true,label:"ONF · lecteur officiel"}]
  };
}
export async function discoverFrenchOnf({existing=[],fetchImpl=fetch,now=new Date()}={}) {
  const rows=[],videos=[],removed=[],seen=new Set();let complete=false,failed=0;
  try {
    for(let page=1;page<=30;page++) {
      const url=new URL("https://publicapi.nfb.ca/api/v5/works");
      for(const [k,v]of Object.entries({locale:"fr",language:"fr",availability:"free",duration_min:"480",include_series_episodes:"true",size:"100",page:String(page),include_fields:"slug,title,category,duration,year,thumbnail,directors,availability,geoblocked,cataloging_language,description,genres,part_of,coming_soon,season,season_number,episode,episode_number"}))url.searchParams.set(k,v);
      const payload=await request(url,{json:true,fetchImpl});
      if(!Array.isArray(payload.items))throw new Error("Format du catalogue ONF inattendu");
      rows.push(...payload.items);
      if(payload.items.length<100){complete=true;break;}
    }
    const previous=new Map(existing.filter(v=>v.source==="onf").map(v=>[v.id,v]));
    await mapLimit(rows,4,async row=>{
      const id=`onf:${row.slug}`;seen.add(id);
      const isEpisode=onfEpisodeEligible(row);
      if(!onfEligible(row)&&!isEpisode){removed.push(id);return;}
      const old=previous.get(id);
      if(old?.lastCheckedAt&&now-new Date(old.lastCheckedAt)<86400000&&!process.env.RECHECK_ALL){
        videos.push(isEpisode?promoteCachedEpisode(old,row,now):old);return;
      }
      try {
        const url=row.availability.resource_url;
        if(!/^https:\/\/www\.onf\.ca\/film\/[\w-]+\/$/.test(url||""))return;
        const html=await request(url,{fetchImpl});
        const film=parseOnfPage(html,row,now);if(film)videos.push(film);else removed.push(id);
      }catch(error){failed++;if([404,410].includes(error.status))removed.push(id);else if(old)videos.push(isEpisode?promoteCachedEpisode({...old,stale:true},row,now):{...old,stale:true});}
    });
  }catch{failed++;}
  for(const old of existing.filter(v=>v.source==="onf"&&!seen.has(v.id))) {
    if(complete)removed.push(old.id);else videos.push({...old,stale:true});
  }
  const episodeCount=videos.filter(v=>v.contentType==='episode').length;
  const seriesCount=new Set(videos.filter(v=>v.contentType==='episode').map(v=>fold(v.seriesTitle||v.title))).size;
  const candidates=rows.filter(onfEpisodeEligible).length;
  return {videos,removed,reports:[{id:"onf",provider:"onf",name:"Office national du film du Canada",status:failed?(videos.length?"partial":"unavailable"):"ok",count:videos.length,episodes:episodeCount,series:seriesCount,seriesCandidates:candidates,discovered:rows.length,...(!failed?{lastSuccessAt:now.toISOString()}:{})}]};
}
