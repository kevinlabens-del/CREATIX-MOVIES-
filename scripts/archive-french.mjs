import {config,request,asText,clean,seconds,isFeature,frenchEvidence,topicsFor,mapLimit} from "./catalog-utils.mjs";

export function archiveLicense(metadata) {
  for(const value of [metadata.licenseurl].flat().filter(Boolean)) {
    try {const u=new URL(value);if(u.hostname!=="creativecommons.org")continue;
      if(/^\/publicdomain\/(?:mark|zero)\/1\.0\/?$/.test(u.pathname))return {rights:u.pathname.includes('zero')?"CC0 déclaré par la source":"Domaine public déclaré par la source",rightsUrl:u.href};
    }catch{}
  }
  return null;
}
export function normalizeArchive(payload,now=new Date(),approvedIdentifiers=config.archiveApprovedIdentifiers||[]) {
  const m=payload.metadata||{},id=m.identifier;
  if(!/^[\w.-]{2,160}$/.test(id||""))return null;
  if(!approvedIdentifiers.includes(id))return null;
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
  return {
    id:`archive:${id}`,source:"archive",identifier:id,title:clean(m.title),channel:clean(m.creator)||"Internet Archive",
    description:clean(m.description).slice(0,420),thumbnail:`https://archive.org/services/img/${encodeURIComponent(id)}`,
    publishedAt:m.publicdate||m.addeddate||null,releaseYear:year?Number(year):null,durationSeconds:file.duration,status:"replay",
    language:"fr",languageLabel:evidence.languageLabel,languageEvidence:evidence.evidence,topics:topicsFor(`${asText(m.subject)} ${asText(m.title)}`),
    score:65,embeddable:true,...licence,sourceUrl:`https://archive.org/details/${id}`,lastCheckedAt:now.toISOString(),verification:"publisher-metadata",
    playbackSources:[{source:type,playbackUrl:direct,embeddable:true,label:"Internet Archive · vidéo directe"},{source:"archive",identifier:id,embeddable:true,label:"Internet Archive · lecteur"}]
  };
}
export async function discoverFrenchArchive({existing=[],fetchImpl=fetch,now=new Date()}={}) {
  const docs=[],videos=[],seen=new Set(),removed=[];let failed=0;
  if(!config.archiveApprovedIdentifiers?.length)return {videos:[],removed:existing.filter(v=>v.source==="archive").map(v=>v.id),reports:[{id:"archive",provider:"archive",name:"Internet Archive",status:"needs-review",count:0,note:"Aucun film dont la piste française et les conditions de diffusion ont été validées manuellement."}]};
  try {
    docs.push(...config.archiveApprovedIdentifiers.map(identifier=>({identifier})));
    const previous=new Map(existing.filter(v=>v.source==="archive").map(v=>[v.id,v]));
    await mapLimit(docs,3,async doc=>{
      const id=`archive:${doc.identifier}`;seen.add(id);
      try{
        const data=await request(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`,{json:true,fetchImpl});
        const v=normalizeArchive(data,now);if(v)videos.push(v);else removed.push(id);
      }catch(error){failed++;if([404,410].includes(error.status))removed.push(id);else if(previous.has(id))videos.push({...previous.get(id),stale:true});}
    });
  }catch{failed++;}
  for(const old of existing.filter(v=>v.source==="archive"&&!seen.has(v.id)))videos.push({...old,stale:true});
  return {videos,removed,reports:[{id:"archive",provider:"archive",name:"Internet Archive",status:failed?(videos.length?"partial":"unavailable"):"ok",count:videos.length,discovered:docs.length,...(!failed?{lastSuccessAt:now.toISOString()}:{})}]};
}
