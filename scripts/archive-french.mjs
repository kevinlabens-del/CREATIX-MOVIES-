import {config,request,asText,clean,seconds,isFeature,frenchEvidence,topicsFor,mapLimit} from "./catalog-utils.mjs";

export function archiveLicense(metadata) {
  for(const value of [metadata.licenseurl].flat().filter(Boolean)) {
    try {
      const u=new URL(value);
      if(u.hostname!=="creativecommons.org")continue;
      if(/^\/publicdomain\/(?:mark|zero)\/1\.0\/?$/.test(u.pathname))return {rights:u.pathname.includes('zero')?"CC0 déclaré par la source":"Domaine public déclaré par la source",rightsUrl:u.href};
    }catch{}
  }
  return null;
}

export function normalizeArchive(payload,now=new Date(),approvedIdentifiers=config.archiveApprovedIdentifiers||[]) {
  const m=payload.metadata||{},id=m.identifier;
  if(!/^[\w.-]{2,160}$/.test(id||""))return null;
  const manuallyApproved=approvedIdentifiers.includes(id);
  if(!manuallyApproved&&!config.archiveAutoDiscovery)return null;
  if(![m.collection].flat().some(c=>config.archiveCollections.includes(c)))return null;
  const licence=archiveLicense(m);if(!licence)return null;
  const evidence=frenchEvidence({language:asText(m.language),title:asText(m.title)});if(!evidence)return null;
  const files=(payload.files||[]).filter(f=>/\.(mp4|webm)$/i.test(f.name||"")&&!f.private&&!/trailer|extrait|sample|preview/i.test(f.name))
    .map(f=>({...f,duration:seconds(f.length)||seconds(m.runtime)})).filter(f=>isFeature(asText(m.title),f.duration,{trustedFilmCatalog:true}))
    .sort((a,b)=>Number(/\bfr|french|francais/i.test(b.name))-Number(/\bfr|french|francais/i.test(a.name))||Number(a.size)-Number(b.size));
  const file=files[0];if(!file)return null;
  const type=/\.webm$/i.test(file.name)?"webm":"mp4";
  const direct=`https://archive.org/download/${encodeURIComponent(id)}/${file.name.split('/').map(encodeURIComponent).join('/')}`;
  const year=asText(m.date).match(/^(\d{4})/)?.[1];
  return {id:`archive:${id}`,source:"archive",identifier:id,title:clean(m.title),channel:clean(m.creator)||"Internet Archive",description:clean(m.description).slice(0,420),thumbnail:`https://archive.org/services/img/${encodeURIComponent(id)}`,publishedAt:m.publicdate||m.addeddate||null,releaseYear:year?Number(year):null,durationSeconds:file.duration,status:"replay",language:"fr",languageLabel:evidence.languageLabel,languageEvidence:evidence.evidence,topics:topicsFor(`${asText(m.subject)} ${asText(m.title)}`),score:manuallyApproved?78:68,embeddable:true,...licence,sourceUrl:`https://archive.org/details/${id}`,lastCheckedAt:now.toISOString(),verification:manuallyApproved?"manual+publisher-metadata":"publisher-metadata",playbackSources:[{source:type,playbackUrl:direct,embeddable:true,label:"Internet Archive · vidéo directe"},{source:"archive",identifier:id,embeddable:true,label:"Internet Archive · lecteur"}]};
}

async function discoverArchiveIdentifiers(fetchImpl) {
  const rows=Math.max(50,Math.min(500,Number(config.archiveSearchRows)||250));
  const pages=Math.max(1,Math.min(20,Number(config.archiveSearchPages)||8));
  const ids=new Set(config.archiveApprovedIdentifiers||[]);
  if(!config.archiveAutoDiscovery)return [...ids];
  const collectionQuery=config.archiveCollections.map(c=>`collection:${c}`).join(" OR ");
  const queries=[`(${collectionQuery}) AND mediatype:movies AND (language:fre OR language:fra OR language:french OR language:fr)`,`(${collectionQuery}) AND mediatype:movies AND title:(VF OR français OR francais OR "film complet")`];
  for(const q of queries) for(let page=1;page<=pages;page++) {
    const u=new URL("https://archive.org/advancedsearch.php");
    for(const [k,v] of Object.entries({q,fl:"identifier,title,language,licenseurl,collection",rows:String(rows),page:String(page),output:"json"}))u.searchParams.set(k,v);
    const data=await request(u,{json:true,fetchImpl,timeout:20000});
    const docs=data?.response?.docs||[];
    // Ne télécharge les métadonnées détaillées que pour les entrées ayant déjà une licence PD/CC0 explicite.
    for(const doc of docs)if(doc.identifier&&archiveLicense(doc)&&frenchEvidence({language:asText(doc.language),title:asText(doc.title)}))ids.add(doc.identifier);
    if(docs.length<rows)break;
  }
  return [...ids];
}

export async function discoverFrenchArchive({existing=[],fetchImpl=fetch,now=new Date()}={}) {
  const videos=[],seen=new Set(),removed=[];let failed=0,discovered=0;
  const previous=new Map(existing.filter(v=>v.source==="archive").map(v=>[v.id,v]));
  let identifiers=[];
  try {identifiers=await discoverArchiveIdentifiers(fetchImpl);discovered=identifiers.length;}catch{failed++;identifiers=[...(config.archiveApprovedIdentifiers||[])];}
  await mapLimit(identifiers,8,async identifier=>{
    const id=`archive:${identifier}`;seen.add(id);const old=previous.get(id);
    if(old?.lastCheckedAt&&now-new Date(old.lastCheckedAt)<86400000&&!process.env.RECHECK_ALL){videos.push(old);return;}
    try{const data=await request(`https://archive.org/metadata/${encodeURIComponent(identifier)}`,{json:true,fetchImpl,timeout:15000});const v=normalizeArchive(data,now);if(v)videos.push(v);else removed.push(id);}
    catch(error){failed++;if([404,410].includes(error.status))removed.push(id);else if(old)videos.push({...old,stale:true});}
  });
  for(const old of previous.values())if(!seen.has(old.id))videos.push({...old,stale:true});
  return {videos,removed,reports:[{id:"archive",provider:"archive",name:"Internet Archive",status:failed?(videos.length?"partial":"unavailable"):"ok",count:videos.length,discovered,method:config.archiveAutoDiscovery?"advancedsearch+prefilter+metadata":"manual-list",...(!failed?{lastSuccessAt:now.toISOString()}:{})}]};
}
