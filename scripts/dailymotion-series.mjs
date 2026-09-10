import {request,clean,frenchEvidence,isFeature,topicsFor,fold} from "./catalog-utils.mjs";

function episodeMeta(title="",description="") {
  const raw=clean(title),text=clean(`${title} ${description}`),t=fold(text);
  const sxe=raw.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i) || raw.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  const ep=raw.match(/(?:épisode|episode|ep\.?)\s*[#n°º-]?\s*(\d{1,3})/i);
  const season=raw.match(/(?:saison|season)\s*(\d{1,2})/i);
  if(!sxe && !ep)return null;
  let seriesTitle=raw
    .replace(/\s*[-–—|:]?\s*(?:saison|season)\s*\d{1,2}.*$/i,"")
    .replace(/\s*[-–—|:]?\s*(?:épisode|episode|ep\.?)\s*[#n°º-]?\s*\d{1,3}.*$/i,"")
    .replace(/\s*[-–—|:]?\s*S\d{1,2}\s*E\d{1,3}.*$/i,"")
    .replace(/\s*[-–—|:]?\s*\d{1,2}x\d{1,3}.*$/i,"")
    .trim();
  if(seriesTitle.length<2)seriesTitle=clean(raw.split(/[|:-]/)[0])||"Série Dailymotion";
  return {seriesTitle,seasonNumber:Number(sxe?.[1]||season?.[1]||1),episodeNumber:Number(sxe?.[2]||ep?.[1])||null};
}

function normalize(item,now=new Date()) {
  if(!/^x[\w]+$/.test(item.id||"")||item.allow_embed!==true||item.private!==false)return null;
  const geo=item.geoblocking||[];
  if(geo[0]==="deny"&&geo.slice(1).includes("FR"))return null;
  if(geo[0]==="allow"&&geo.length>1&&!geo.slice(1).includes("FR"))return null;
  const episode=episodeMeta(item.title,item.description);if(!episode)return null;
  if(!isFeature(item.title,Number(item.duration),{allowEpisode:true}))return null;
  const evidence=frenchEvidence({title:item.title,language:item.language});if(!evidence)return null;
  const publisher=clean(item["owner.screenname"]||item["owner.username"]||"Dailymotion");
  return {id:`dailymotion:${item.id}`,source:"dailymotion",videoId:item.id,title:clean(item.title),channel:publisher,
    description:clean(item.description).slice(0,420),publishedAt:item.created_time?new Date(item.created_time*1000).toISOString():null,
    thumbnail:item.thumbnail_360_url||"",status:"replay",durationSeconds:Number(item.duration),contentType:"episode",...episode,
    language:"fr",languageLabel:evidence.languageLabel,languageEvidence:evidence.evidence,topics:[...new Set(["Série",...topicsFor(item.title,false)])],
    score:84,embeddable:true,sourceUrl:`https://www.dailymotion.com/video/${item.id}`,
    rights:"Lecteur officiel Dailymotion · droits conservés par l’éditeur",lastCheckedAt:now.toISOString(),verification:"publisher-metadata",
    playbackSources:[{source:"dailymotion",videoId:item.id,embeddable:true,label:`Dailymotion · ${publisher}`}]
  };
}

export async function discoverFrenchDailymotionSeries({fetchImpl=fetch,now=new Date()}={}) {
  const videos=[],reports=[],removed=[],seen=new Set();
  const fields="id,title,duration,language,allow_embed,geoblocking,private,description,thumbnail_360_url,created_time,owner.screenname,owner.username";
  const searches=["épisode 1","épisode 2","épisode 3","episode 1","serie francaise episode","série française épisode","saison 1 épisode","mini série épisode"];
  let pages=0,failed=false;
  try {
    for(const search of searches) for(let page=1;page<=Number(process.env.DAILYMOTION_SERIES_PAGES||12);page++) {
      const url=new URL("https://api.dailymotion.com/videos");
      for(const [k,v] of Object.entries({fields,limit:"100",page:String(page),sort:"relevance",languages:"fr",private:"false",search}))url.searchParams.set(k,v);
      const payload=await request(url,{json:true,fetchImpl});pages++;
      for(const row of payload.list||[]) {
        const id=`dailymotion:${row.id}`;if(seen.has(id))continue;seen.add(id);
        const item=normalize(row,now);if(item)videos.push(item);else removed.push(id);
      }
      if(!payload.has_more)break;
    }
  }catch{failed=true;}
  reports.push({id:"dailymotion-series",provider:"dailymotion",name:"Dailymotion · séries françaises",status:failed?(pages?"partial":"unavailable"):"ok",count:videos.length,episodes:videos.length,discoveredPages:pages,...(!failed?{lastSuccessAt:now.toISOString()}:{})});
  return {videos,reports,removed};
}
