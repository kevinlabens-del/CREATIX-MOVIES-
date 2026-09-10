import {config, request, jsonAssignment, walkKeys, ytText, seconds, frenchEvidence, isFeature, clean, topicsFor, mapLimit, fold} from "./catalog-utils.mjs";

function episodeMeta(title="") {
  const raw=clean(title),t=fold(raw);
  const sxe=raw.match(/\bS(\d{1,2})E(\d{1,3})\b/i);
  const ep=raw.match(/(?:épisode|episode|ep\.?)\s*(\d{1,3})/i);
  const season=raw.match(/(?:saison|season)\s*(\d{1,2})/i);
  const isEpisode=Boolean(sxe||ep||/\b(?:episode|saison|season)\b/i.test(t));
  if(!isEpisode)return null;
  let seriesTitle=raw
    .replace(/\s*[-–—|:]?\s*(?:saison|season)\s*\d{1,2}.*$/i,"")
    .replace(/\s*[-–—|:]?\s*(?:épisode|episode|ep\.?)\s*\d{1,3}.*$/i,"")
    .replace(/\s*[-–—|:]?\s*S\d{1,2}E\d{1,3}.*$/i,"")
    .trim();
  if(seriesTitle.length<2)seriesTitle="Série YouTube";
  return {seriesTitle,seasonNumber:Number(sxe?.[1]||season?.[1]||1),episodeNumber:Number(sxe?.[2]||ep?.[1])||null};
}

export function extractChannelVideos(data) {
  const videos = new Map();
  for (const row of [...walkKeys(data, "videoRenderer"), ...walkKeys(data, "playlistVideoRenderer")]) {
    const duration = seconds(ytText(row.lengthText)) || Number(row.lengthSeconds) || null;
    if (row.videoId) videos.set(row.videoId, {id:row.videoId, title:ytText(row.title), duration});
  }
  for (const row of walkKeys(data, "lockupViewModel")) {
    const id = row.contentId;
    if (!/^[\w-]{11}$/.test(id || "")) continue;
    const badges = [...walkKeys(row.contentImage, "thumbnailBadgeViewModel")];
    const duration = badges.map((b)=>seconds(b.text)).find(Boolean) || null;
    videos.set(id,{id,title:ytText(row.metadata?.lockupMetadataViewModel?.title),duration});
  }
  return [...videos.values()];
}

export function normalizeWatch(data, expectedChannel, now = new Date()) {
  const details = data?.videoDetails, micro = data?.microformat?.playerMicroformatRenderer;
  const playable = data?.playabilityStatus;
  if (!details || details.channelId !== expectedChannel.id || playable?.status !== "OK" || playable.playableInEmbed !== true) return null;
  if (details.isLiveContent && (details.isLive || !micro?.liveBroadcastDetails?.endTimestamp)) return null;
  if (micro?.hasYpcMetadata || (Array.isArray(micro?.availableCountries) && !micro.availableCountries.includes(config.region))) return null;
  const duration = Number(details.lengthSeconds);
  const title = clean(details.title);
  const episode=episodeMeta(title);
  if (!isFeature(title,duration,{documentary:expectedChannel.documentaries,allowEpisode:Boolean(episode)})) return null;
  const audioTracks = (data.streamingData?.adaptiveFormats || []).map((f)=>f.audioTrack).filter(Boolean);
  const evidence = frenchEvidence({title,audioTracks});
  if (!evidence) return null;
  const topics=topicsFor(title,expectedChannel.documentaries);if(episode)topics.unshift("Série");
  return {
    id:`youtube:${details.videoId}`,source:"youtube",videoId:details.videoId,title,
    channel:clean(details.author || expectedChannel.name), channelId:details.channelId,
    description:clean(details.shortDescription || "").replace(/https?:\/\/\S+/g,"").slice(0,420),
    thumbnail:`https://i.ytimg.com/vi/${details.videoId}/hqdefault.jpg`,
    publishedAt:micro?.publishDate || null, status:"replay", durationSeconds:duration,
    contentType:episode?"episode":"film",...(episode||{}),
    language:evidence.language,languageLabel:evidence.languageLabel,languageEvidence:evidence.evidence,
    topics:[...new Set(topics)],score:episode?87:90,embeddable:true,
    sourceUrl:`https://www.youtube.com/watch?v=${details.videoId}`,
    rights:"Lecteur officiel YouTube · droits conservés par l’éditeur",
    lastCheckedAt:now.toISOString(),verification:"publisher-metadata",
    playbackSources:[{source:"youtube",videoId:details.videoId,embeddable:true,label:`YouTube · ${clean(details.author || expectedChannel.name)}`}],
  };
}

async function api(path,params,key,fetchImpl) {
  const url=new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for(const [k,v] of Object.entries({...params,key})) url.searchParams.set(k,v);
  return request(url,{json:true,fetchImpl});
}

export async function discoverFrenchYouTube({existing=[],fetchImpl=fetch,now=new Date(),apiKey=process.env.YOUTUBE_API_KEY}={}) {
  const reports=[],candidates=new Map(),channels=new Map(),removed=new Set();
  const previous = new Map(existing.filter(v=>v.source==="youtube").map(v=>[v.videoId,v]));
  for (const source of config.youtubeChannels) {
    try {
      let id, rows=[];
      if (apiKey) {
        const result=await api("channels",{part:"id,contentDetails",forHandle:source.handle},apiKey,fetchImpl);
        id=result.items?.[0]?.id;
        const playlistId=result.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if(!id||!playlistId)throw new Error("Chaîne introuvable");
        let token="";
        for(let page=0;page<Number(process.env.YOUTUBE_PLAYLIST_PAGES || 20);page++) {
          const p=await api("playlistItems",{part:"contentDetails,snippet",playlistId,maxResults:"50",...(token?{pageToken:token}:{})},apiKey,fetchImpl);
          rows.push(...(p.items||[]).map(x=>({id:x.contentDetails?.videoId,title:x.snippet?.title,duration:null})));
          token=p.nextPageToken; if(!token)break;
        }
      } else {
        id=source.id;
        const pages=await Promise.allSettled([
          request(`https://www.youtube.com/@${source.handle}/videos?hl=fr&gl=FR`,{fetchImpl,timeout:35000}),
          request(`https://www.youtube.com/playlist?list=UU${id.slice(2)}&hl=fr&gl=FR`,{fetchImpl,timeout:35000})
        ]);
        if(pages.every(p=>p.status==="rejected"))throw pages[0].reason;
        for(const page of pages)if(page.status==="fulfilled") {
          const data=jsonAssignment(page.value,"ytInitialData");
          const channel=data?.metadata?.channelMetadataRenderer?.externalId;
          if(channel&&channel!==id)throw new Error("La chaîne source a changé");
          rows.push(...extractChannelVideos(data));
        }
        if(!/^UC[\w-]{22}$/.test(id||""))throw new Error("Catalogue public indisponible");
        if(!rows.length)throw new Error("Aucune fiche dans la page de la chaîne");
      }
      channels.set(id,{...source,id});
      for (const row of rows) {
        if(!/^[\w-]{11}$/.test(row.id||""))continue;
        if(!frenchEvidence({title:row.title}))continue;
        const episode=episodeMeta(row.title);
        if(row.duration && !isFeature(row.title,row.duration,{documentary:source.documentaries,allowEpisode:Boolean(episode)}))continue;
        candidates.set(row.id,{...row,channelId:id});
      }
      reports.push({id:`youtube:${source.handle}`,name:source.name,provider:"youtube",status:"ok",channelId:id,discovered:rows.length,method:apiKey?"api":"public-pages"});
    } catch(error) {
      reports.push({id:`youtube:${source.handle}`,name:source.name,provider:"youtube",status:"unavailable",detail:error.message});
      if(error.status===429)break;
    }
  }
  for(const v of previous.values()) if(channels.has(v.channelId))candidates.set(v.videoId,{id:v.videoId,channelId:v.channelId});
  let rateLimited=false,failed=0,checked=0;
  const videos=(await mapLimit([...candidates.values()],3,async row=>{
    const old=previous.get(row.id);
    if(old?.lastCheckedAt && now-new Date(old.lastCheckedAt)<86400000 && !process.env.RECHECK_ALL)return old;
    if(rateLimited)return old||null;
    try {
      const html=await request(`https://www.youtube.com/watch?v=${row.id}&hl=fr&gl=FR`,{fetchImpl,timeout:20000});
      const data=jsonAssignment(html,"ytInitialPlayerResponse");
      if(!data?.playabilityStatus)throw new Error("Métadonnées du lecteur indisponibles");
      const status=data.playabilityStatus.status;
      if(status==="LOGIN_REQUIRED" && /bot|robot|confirm/i.test(JSON.stringify(data.playabilityStatus)))throw new Error("Vérification du service requise");
      checked++;
      const video=normalizeWatch(data,channels.get(row.channelId),now);
      if(!video)removed.add(`youtube:${row.id}`);
      return video;
    }catch(error){failed++;if(error.status===429)rateLimited=true;return old?{...old,stale:true}:null;}
  })).filter(Boolean);
  for(const old of previous.values())if(!channels.has(old.channelId))videos.push({...old,stale:true});
  for(const report of reports) {
    report.count=videos.filter(v=>v.channelId===report.channelId).length;
    report.episodes=videos.filter(v=>v.channelId===report.channelId&&v.contentType==="episode").length;
    if(failed&&report.status==="ok")report.status="partial";
    if(report.status==="ok")report.lastSuccessAt=now.toISOString();
  }
  return {videos,reports,removed:[...removed],stats:{checked,failed,candidates:candidates.size,episodes:videos.filter(v=>v.contentType==="episode").length}};
}
