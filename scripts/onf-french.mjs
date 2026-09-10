import {request,clean,isFeature,topicsFor,mapLimit,fold} from "./catalog-utils.mjs";

export function onfEligible(row) {
  return row?.category === "film" && row.availability?.is_public === true && row.geoblocked === false &&
    !row.coming_soon && !(row.part_of || []).some(p=>p.category==="series") &&
    isFeature(row.title,Number(row.duration),{trustedFilmCatalog:true}) &&
    !/sans paroles|sans dialogue|silent film|no dialogue/i.test(row.description || "");
}
export function onfEpisodeEligible(row) {
  return row?.category === "film" && row.availability?.is_public === true && row.geoblocked === false &&
    !row.coming_soon && (row.part_of || []).some(p=>p.category==="series") &&
    isFeature(row.title,Number(row.duration),{trustedFilmCatalog:true,allowEpisode:true}) &&
    !/sans paroles|sans dialogue|silent film|no dialogue/i.test(row.description || "");
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
  const seriesParent=(row.part_of||[]).find(p=>p.category==='series');
  const isEpisode=Boolean(seriesParent);
  const topics=topicsFor(`${row.title} ${(row.genres||[]).map(g=>typeof g==='object'?g.name:g).join(' ')}`,documentary);
  if(isEpisode)topics.unshift('Série');
  return {
    id:`onf:${row.slug}`,source:"onf",videoId:row.slug,title:clean(row.title),channel:"Office national du film du Canada",
    description:clean(metadata.description||row.description).slice(0,420),thumbnail:image||"",
    durationSeconds:Number(row.duration),releaseYear:row.year||null,publishedAt:metadata.uploadDate||null,status:"replay",
    contentType:isEpisode?"episode":"film",seriesTitle:isEpisode?clean(seriesParent?.title||seriesParent?.name||seriesParent?.label||""):null,
    language:"fr",languageLabel:"Français · ONF",languageEvidence:language?"publisher-audio":"publisher-language-filter",
    topics:[...new Set(topics)],score:isEpisode?73:75,embeddable:true,sourceUrl:row.availability.resource_url,
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
      for(const [k,v]of Object.entries({locale:"fr",language:"fr",availability:"free",duration_min:"480",include_series_episodes:"true",size:"100",page:String(page),include_fields:"slug,duration,year,thumbnail,directors,availability,geoblocked,cataloging_language,description,genres,part_of,coming_soon"}))url.searchParams.set(k,v);
      const payload=await request(url,{json:true,fetchImpl});
      if(!Array.isArray(payload.items))throw new Error("Format du catalogue ONF inattendu");
      rows.push(...payload.items);
      if(payload.items.length<100){complete=true;break;}
    }
    const previous=new Map(existing.filter(v=>v.source==="onf").map(v=>[v.id,v]));
    await mapLimit(rows,3,async row=>{
      const id=`onf:${row.slug}`;seen.add(id);
      if(!onfEligible(row)&&!onfEpisodeEligible(row)){removed.push(id);return;}
      const old=previous.get(id);
      if(old?.lastCheckedAt&&now-new Date(old.lastCheckedAt)<86400000&&!process.env.RECHECK_ALL){videos.push(old);return;}
      try {
        const url=row.availability.resource_url;
        if(!/^https:\/\/www\.onf\.ca\/film\/[\w-]+\/$/.test(url||""))return;
        const html=await request(url,{fetchImpl});
        const film=parseOnfPage(html,row,now);if(film)videos.push(film);else removed.push(id);
      }catch(error){failed++;if([404,410].includes(error.status))removed.push(id);else if(old)videos.push({...old,stale:true});}
    });
  }catch{failed++;}
  for(const old of existing.filter(v=>v.source==="onf"&&!seen.has(v.id))) {
    if(complete)removed.push(old.id);else videos.push({...old,stale:true});
  }
  const episodeCount=videos.filter(v=>v.contentType==='episode').length;
  return {videos,removed,reports:[{id:"onf",provider:"onf",name:"Office national du film du Canada",status:failed?(videos.length?"partial":"unavailable"):"ok",count:videos.length,episodes:episodeCount,discovered:rows.length,...(!failed?{lastSuccessAt:now.toISOString()}:{})}]};
}
