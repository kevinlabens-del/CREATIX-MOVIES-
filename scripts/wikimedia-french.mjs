import {config,request,clean,isFeature,topicsFor} from "./catalog-utils.mjs";

export function normalizeCommons(page,now=new Date()) {
  const info=page.videoinfo?.[0],meta=info?.extmetadata||{};
  if(!info||!info.url?.startsWith("https://upload.wikimedia.org/"))return null;
  const categories=meta.Categories?.value||"";
  const configured=(config.wikimediaCategories||["French-language films"]).some(c=>categories.toLowerCase().includes(String(c).toLowerCase()));
  if(!configured&&!page.__cr3atixFrenchFilmCategory)return null;
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
    topics:topicsFor(`${categories} ${page.__cr3atixCategory||""}`),score:64,embeddable:true,rights:clean(licence),rightsUrl:meta.LicenseUrl?.value||info.descriptionurl,
    attribution:clean(meta.Artist?.value||meta.Credit?.value),sourceUrl:info.descriptionurl,lastCheckedAt:now.toISOString(),verification:"publisher-metadata+category-tree",
    playbackSources:[{source:type,playbackUrl:info.url,embeddable:true,label:"Wikimedia Commons"}]
  };
}

async function listSubcategories(category,fetchImpl) {
  const found=[];let cmcontinue=null;
  for(let round=0;round<10;round++) {
    const u=new URL("https://commons.wikimedia.org/w/api.php");
    for(const [k,v] of Object.entries({action:"query",format:"json",list:"categorymembers",cmtitle:`Category:${category}`,cmtype:"subcat",cmlimit:"500",...(cmcontinue?{cmcontinue}:{})}))u.searchParams.set(k,v);
    const data=await request(u,{json:true,fetchImpl,timeout:30000});
    if(data.error)throw new Error("API Commons indisponible");
    for(const member of data.query?.categorymembers||[])if(member.title?.startsWith("Category:"))found.push(member.title.slice(9));
    cmcontinue=data.continue?.cmcontinue;if(!cmcontinue)break;
  }
  return found;
}

async function expandCategories(roots,fetchImpl) {
  const depth=Math.max(0,Math.min(3,Number(config.wikimediaCategoryDepth)??2));
  const maxCategories=Math.max(20,Math.min(250,Number(config.wikimediaMaxCategories)||160));
  const seen=new Set(),queue=roots.map(name=>({name,level:0}));
  while(queue.length&&seen.size<maxCategories) {
    const current=queue.shift();if(!current?.name||seen.has(current.name))continue;
    seen.add(current.name);
    if(current.level>=depth)continue;
    try {
      const children=await listSubcategories(current.name,fetchImpl);
      for(const child of children)if(!seen.has(child)&&seen.size+queue.length<maxCategories)queue.push({name:child,level:current.level+1});
    } catch {}
  }
  return [...seen];
}

async function collectCategory(category,fetchImpl,pages) {
  let next={};
  const rounds=Math.max(1,Math.min(100,Number(config.wikimediaPagesPerCategory)||40));
  for(let round=0;round<rounds;round++) {
    const u=new URL("https://commons.wikimedia.org/w/api.php");
    for(const [k,v] of Object.entries({action:"query",format:"json",generator:"categorymembers",gcmtitle:`Category:${category}`,gcmtype:"file",gcmlimit:"50",prop:"videoinfo",viprop:"url|size|extmetadata",viurlwidth:"480",...next}))u.searchParams.set(k,v);
    const data=await request(u,{json:true,fetchImpl,timeout:30000});
    if(data.error)throw new Error("API Commons indisponible");
    for(const page of Object.values(data.query?.pages||{}))pages.set(page.pageid,{...page,__cr3atixFrenchFilmCategory:true,__cr3atixCategory:category});
    next=data.continue;if(!next)break;
  }
}

export async function discoverFrenchCommons({existing=[],fetchImpl=fetch,now=new Date()}={}) {
  const pages=new Map(),videos=[],removed=[];let failure=false;
  const roots=[...new Set([...(config.wikimediaCategories||["French-language films"]),"Videos of films in French"])];
  let categories=roots;
  try {
    categories=await expandCategories(roots,fetchImpl);
    for(const category of categories)await collectCategory(category,fetchImpl,pages);
    for(const page of pages.values()) {const video=normalizeCommons(page,now);if(video)videos.push(video);else removed.push(`wikimedia:${page.pageid}`);}
  }catch{failure=true;}
  for(const old of existing.filter(v=>v.provider==="wikimedia"&&!pages.has(Number(v.id.split(':')[1]))))if(failure)videos.push({...old,stale:true});
  return {videos,removed,reports:[{id:"wikimedia",provider:"wikimedia",name:"Wikimedia Commons",status:failure?(videos.length?"partial":"unavailable"):"ok",count:videos.length,discovered:pages.size,categories:categories.length,method:"recursive-category-tree",...(!failure?{lastSuccessAt:now.toISOString()}:{})}]};
}
