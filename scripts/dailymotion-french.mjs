import {config,request,clean,frenchEvidence,isFeature,topicsFor,fold} from "./catalog-utils.mjs";

function episodeMeta(title="") {
  const raw=clean(title),t=fold(raw);
  const episodeMatch=raw.match(/(?:épisode|episode|ep\.?|e)\s*(\d{1,3})/i) || raw.match(/\bS(\d{1,2})E(\d{1,3})\b/i);
  const seasonMatch=raw.match(/(?:saison|season|s)\s*(\d{1,2})/i) || raw.match(/\bS(\d{1,2})E\d{1,3}\b/i);
  const isEpisode=/\b(?:episode|saison|season)\b|\bs\d{1,2}e\d{1,3}\b|\bep\.?\s*\d{1,3}\b/i.test(t);
  if(!isEpisode)return null;
  let seriesTitle=raw
    .replace(/\s*[-–—|:]?\s*(?:saison|season)\s*\d{1,2}.*$/i,"")
    .replace(/\s*[-–—|:]?\s*(?:épisode|episode|ep\.?)\s*\d{1,3}.*$/i,"")
    .replace(/\s*[-–—|:]?\s*S\d{1,2}E\d{1,3}.*$/i,"")
    .trim();
  if(seriesTitle.length<2)seriesTitle="Série Dailymotion";
  const seasonNumber=seasonMatch?Number(seasonMatch[1]):1;
  const episodeNumber=episodeMatch?Number(episodeMatch[2]||episodeMatch[1]):null;
  return {seriesTitle,seasonNumber,episodeNumber};
}

export function normalizeDailymotion(item,owner,now=new Date()) {
  if(!/^x[\w]+$/.test(item.id||"")||item.allow_embed!==true||item.private!==false)return null;
  const geo=item.geoblocking||[];
  if(geo[0]==="deny"&&geo.slice(1).includes("FR"))return null;
  if(geo[0]==="allow"&&geo.length>1&&!geo.slice(1).includes("FR"))return null;
  const documentary=/documentaire|documentary/i.test(item.title||"");
  const episode=episodeMeta(item.title);
  if(!isFeature(item.title,item.duration,{documentary,allowEpisode:Boolean(episode)}))return null;
  const evidence=frenchEvidence({title:item.title,language:item.language});
  if(!evidence)return null;
  const topics=topicsFor(item.title,documentary);
  if(episode)topics.unshift("Série");
  return {
    id:`dailymotion:${item.id}`,source:"dailymotion",videoId:item.id,title:clean(item.title),
    channel:clean(item["owner.screenname"]||owner.name),description:clean(item.description).slice(0,420),
    publishedAt:item.created_time?new Date(item.created_time*1000).toISOString():null,
    thumbnail:item.thumbnail_360_url||"",status:"replay",durationSeconds:item.duration,
    contentType:episode?"episode":"film",...(episode||{}),
    language:"fr",languageLabel:evidence.languageLabel,languageEvidence:evidence.evidence,
    topics:[...new Set(topics)],score:episode?82:85,embeddable:true,
    sourceUrl:`https://www.dailymotion.com/video/${item.id}`,rights:"Lecteur officiel Dailymotion · droits conservés par l’éditeur",
    lastCheckedAt:now.toISOString(),verification:"publisher-metadata",
    playbackSources:[{source:"dailymotion",videoId:item.id,embeddable:true,label:`Dailymotion · ${owner.name}`}]
  };
}
export async function discoverFrenchDailymotion({existing=[],fetchImpl=fetch,now=new Date()}={}) {
  const videos=[],reports=[],seen=new Set(),removed=[];
  const fields="id,title,duration,language,allow_embed,geoblocking,private,description,thumbnail_360_url,created_time,owner.id,owner.screenname,owner.username,channel";
  for(const owner of config.dailymotionOwners) {
    let failed=false,pages=0;
    try {
      for(const search of ["film complet","documentaire","épisode","episode","saison",""]) for(let page=1;page<=Number(process.env.DAILYMOTION_PAGES||10);page++) {
        const url=new URL(`https://api.dailymotion.com/user/${owner.id}/videos`);
        for(const [k,v] of Object.entries({fields,limit:"100",page:String(page),sort:"recent",languages:"fr",private:"false",...(search?{search}:{})}))url.searchParams.set(k,v);
        const payload=await request(url,{json:true,fetchImpl});pages++;
        for(const row of payload.list||[]) {
          if(seen.has(`dailymotion:${row.id}`))continue;
          seen.add(`dailymotion:${row.id}`);
          const item=normalizeDailymotion(row,owner,now);
          if(item)videos.push(item);else removed.push(`dailymotion:${row.id}`);
        }
        if(!payload.has_more)break;
      }
    }catch{failed=true;}
    reports.push({id:`dailymotion:${owner.id}`,provider:"dailymotion",name:`Dailymotion · ${owner.name}`,status:failed?(pages?"partial":"unavailable"):"ok",count:videos.length,episodes:videos.filter(v=>v.contentType==="episode").length,...(!failed?{lastSuccessAt:now.toISOString()}:{})});
  }
  for(const movie of existing.filter(v=>v.source==="dailymotion"&&!seen.has(v.id))) {
    try {
      const row=await request(`https://api.dailymotion.com/video/${movie.videoId}?fields=${encodeURIComponent(fields)}`,{json:true,fetchImpl});
      const normalized=normalizeDailymotion(row,{name:movie.channel},now);
      if(normalized)videos.push(normalized);else removed.push(movie.id);
    }catch(error){if([404,410].includes(error.status))removed.push(movie.id);else videos.push({...movie,stale:true});}
  }
  return {videos,reports,removed};
}
