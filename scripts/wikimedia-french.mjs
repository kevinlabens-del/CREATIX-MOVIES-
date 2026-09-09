import {request,clean,fold,isFeature,topicsFor} from "./catalog-utils.mjs";

export function normalizeCommons(page,now=new Date()) {
  const info=page.videoinfo?.[0],meta=info?.extmetadata||{};
  if(!info||!info.url?.startsWith("https://upload.wikimedia.org/"))return null;
  const categories=meta.Categories?.value||"";
  if(!/French-language films/i.test(categories))return null;
  const title=clean(meta.ObjectName?.value||page.title.replace(/^File:/,"").replace(/\.(webm|ogv|mp4)$/i,""));
  if(!isFeature(title,info.duration,{trustedFilmCatalog:true}))return null;
  const licence=meta.LicenseShortName?.value||"";
  if(!/^(?:CC BY(?:-SA)?|CC0|Public domain)/i.test(licence))return null;
  const type=/\.mp4(?:\?|$)/i.test(info.url)?"mp4":/\.webm(?:\?|$)/i.test(info.url)?"webm":null;
  if(!type)return null;
  return {
    id:`wikimedia:${page.pageid}`,source:type,provider:"wikimedia",playbackUrl:info.url,title,
    channel:"Wikimedia Commons",description:clean(meta.ImageDescription?.value).slice(0,420),thumbnail:info.thumburl||"",
    publishedAt:meta.DateTime?.value||null,durationSeconds:Math.round(info.duration),status:"replay",language:"fr",languageLabel:"Français · Commons",languageEvidence:"publisher-category",
    topics:topicsFor(categories),score:60,embeddable:true,rights:clean(licence),rightsUrl:meta.LicenseUrl?.value||info.descriptionurl,
    attribution:clean(meta.Artist?.value||meta.Credit?.value),sourceUrl:info.descriptionurl,lastCheckedAt:now.toISOString(),verification:"publisher-metadata",
    playbackSources:[{source:type,playbackUrl:info.url,embeddable:true,label:"Wikimedia Commons"}]
  };
}
export async function discoverFrenchCommons({existing=[],fetchImpl=fetch,now=new Date()}={}) {
  const pages=new Map(),videos=[],removed=[];let failure=false;
  try {
    let next={};
    for(let round=0;round<20;round++) {
      const u=new URL("https://commons.wikimedia.org/w/api.php");
      for(const [k,v] of Object.entries({action:"query",format:"json",generator:"categorymembers",gcmtitle:"Category:French-language films",gcmtype:"file",gcmlimit:"50",prop:"videoinfo",viprop:"url|size|extmetadata",viurlwidth:"480",...next}))u.searchParams.set(k,v);
      const data=await request(u,{json:true,fetchImpl});
      if(data.error)throw new Error("API Commons indisponible");
      for(const page of Object.values(data.query?.pages||{}))pages.set(page.pageid,page);
      next=data.continue;if(!next)break;
    }
    for(const page of pages.values()) {const video=normalizeCommons(page,now);if(video)videos.push(video);else removed.push(`wikimedia:${page.pageid}`);}
  }catch{failure=true;}
  for(const old of existing.filter(v=>v.provider==="wikimedia"&&!pages.has(Number(v.id.split(':')[1]))))if(failure)videos.push({...old,stale:true});
  return {videos,removed,reports:[{id:"wikimedia",provider:"wikimedia",name:"Wikimedia Commons",status:failure?"unavailable":"ok",count:videos.length,discovered:pages.size,...(!failure?{lastSuccessAt:now.toISOString()}:{})}]};
}
