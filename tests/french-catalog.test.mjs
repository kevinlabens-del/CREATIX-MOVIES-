import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {frenchEvidence,isFeature,mergeMovies,seconds,jsonAssignment} from '../scripts/catalog-utils.mjs';
import {normalizeWatch,extractChannelVideos} from '../scripts/youtube-french.mjs';
import {normalizeDailymotion} from '../scripts/dailymotion-french.mjs';
import {onfEligible,parseOnfPage} from '../scripts/onf-french.mjs';
import {normalizeArchive,archiveLicense} from '../scripts/archive-french.mjs';
import {isPlayableMovie,isPlayableSource,filterCatalog,getPlayableSources} from '../src/catalog.js';

const date=new Date('2026-09-09T00:00:00Z');
const channel={id:'UCQltP9CZKGug5kTf6cppVgg',name:'Éditeur'};
const watch=()=>({videoDetails:{videoId:'abcdefghijk',channelId:channel.id,title:'Un voyage | Film Complet en Français',lengthSeconds:'5400',author:'Éditeur'},playabilityStatus:{status:'OK',playableInEmbed:true},microformat:{playerMicroformatRenderer:{availableCountries:['FR'],publishDate:'2020-01-01'}}});
const dm=()=>({id:'x123abc',title:'Un voyage - film complet',duration:5400,language:'fr',allow_embed:true,private:false,geoblocking:['allow']});
const onf=()=>({category:'film',slug:'un_voyage',title:'Un voyage',duration:5400,geoblocked:false,availability:{is_public:true,resource_url:'https://www.onf.ca/film/un_voyage/'},part_of:[{category:'collection'}],genres:['Documentaire']});

test('une traduction du titre ou des sous-titres ne suffisent pas à prouver une piste française',()=>{
  assert.equal(frenchEvidence({title:'Un merveilleux voyage'}),null);
  assert.equal(frenchEvidence({title:'A journey - film complet VOSTFR'}),null);
  assert.equal(frenchEvidence({title:'A journey with French subtitles'}),null);
  assert.equal(frenchEvidence({title:'A journey',language:'en'}),null);
  assert.equal(frenchEvidence({title:'A journey VF'}).evidence,'publisher-title');
  assert.equal(frenchEvidence({audioTracks:[{id:'fr.4',displayName:'Français'}]}).evidence,'audio-track');
});

test('le catalogue exclut durées inconnues, extraits longs, épisodes et compilations',()=>{
  for(const title of ['Un voyage - bande-annonce','Un voyage - Episode 12','Un voyage - Partie 1','Film complet - compilation','Film complet 1/2'])assert.equal(isFeature(title,5400,{trustedFilmCatalog:true}),false,title);
  assert.equal(isFeature('Film complet VF',2300),false);
  assert.equal(isFeature('Film complet VF',null),false);
  assert.equal(isFeature('Film complet VF',5400),true);
  assert.equal(seconds('1:30:00'),5400);assert.equal(seconds('PT1H30M'),5400);
});

test('YouTube exige la bonne chaîne, la lecture intégrable et la disponibilité déclarée en France',()=>{
  assert.ok(normalizeWatch(watch(),channel,date));
  for(const mutate of [d=>d.playabilityStatus.playableInEmbed=false,d=>d.videoDetails.channelId='autre',d=>d.microformat.playerMicroformatRenderer.availableCountries=['CA'],d=>d.microformat.playerMicroformatRenderer.hasYpcMetadata=true,d=>d.playabilityStatus.status='UNPLAYABLE',d=>d.videoDetails.title='Un voyage - VOSTFR']){
    const data=watch();mutate(data);assert.equal(normalizeWatch(data,channel,date),null);
  }
});

test('les anciens et nouveaux formats publics YouTube exposent les durées sans extraire le flux',()=>{
  const rows=extractChannelVideos({a:{videoRenderer:{videoId:'abcdefghijk',title:{runs:[{text:'Film VF'}]},lengthText:{simpleText:'1:30:00'}}},b:{lockupViewModel:{contentId:'ABCDEFGHIJK',metadata:{lockupMetadataViewModel:{title:{content:'Autre film VF'}}},contentImage:{x:{thumbnailBadgeViewModel:{text:'1:40:00'}}}}}});
  assert.deepEqual(rows.map(r=>r.duration),[5400,6000]);
  const value={title:'Un titre avec } et " guillemets',nested:{ok:true}};
  assert.deepEqual(jsonAssignment(`var ytInitialData = ${JSON.stringify(value)}; suite`,'ytInitialData'),value);
});

test('Dailymotion exclut vidéos privées, restrictions FR et langue anglaise',()=>{
  assert.ok(normalizeDailymotion(dm(),{name:'imineo'},date));
  for(const mutate of [d=>d.private=true,d=>d.allow_embed=false,d=>d.language='en',d=>d.geoblocking=['allow','CA'],d=>d.geoblocking=['deny','FR']]){
    const item=dm();mutate(item);assert.equal(normalizeDailymotion(item,{name:'imineo'},date),null);
  }
});

test('ONF conserve un film en collection et exclut épisodes, contenus payants et lecteur tiers',()=>{
  assert.equal(onfEligible(onf()),true);
  assert.equal(onfEligible({...onf(),part_of:[{category:'series'}]}),false);
  assert.equal(onfEligible({...onf(),geoblocked:true}),false);
  assert.equal(onfEligible({...onf(),availability:{is_public:false}}),false);
  const html=(host='www.onf.ca',lang='FR')=>`<script type="application/ld+json">${JSON.stringify({embedUrl:`https://${host}/film/un_voyage/embed/player/`,director:[{name:'Créatrice'}]})}</script><script>const analytics={"nfb_version_lang":"${lang}"}</script>`;
  const video=parseOnfPage(html(),onf(),date);
  assert.ok(video);assert.match(video.attribution,/Créatrice/);
  assert.equal(parseOnfPage(html('example.com'),onf(),date),null);
  assert.equal(parseOnfPage(html('www.onf.ca','EN'),onf(),date),null);
});

test('une étiquette domaine public sur Archive ne déclenche aucun import sans validation explicite',()=>{
  const payload={metadata:{identifier:'film-valide',title:'Un voyage',collection:['feature_films'],language:'fr',licenseurl:'https://creativecommons.org/publicdomain/mark/1.0/'},files:[{name:'film.mp4',length:5400,size:'5000'}]};
  assert.equal(normalizeArchive(payload,date),null);
  assert.ok(normalizeArchive(payload,date,['film-valide']));
  assert.equal(archiveLicense({licenseurl:'https://creativecommons.org.evil.test/publicdomain/mark/1.0/'}),null);
  assert.equal(archiveLicense({rights:'Public domain'}),null);
});

test('les doublons conservent toutes les sources et tous les crédits, les remakes restent distincts',()=>{
  const first=normalizeWatch(watch(),channel,date);
  const second=normalizeDailymotion(dm(),{name:'imineo'},date);
  const merged=mergeMovies([first,second]);
  assert.equal(merged.length,1);assert.equal(merged[0].playbackSources.length,2);assert.equal(merged[0].credits.length,2);
  assert.equal(mergeMovies([{...first,releaseYear:1990},{...second,releaseYear:2010}]).length,2);
  assert.equal(mergeMovies([{...first,language:'en'}]).length,0);
});

test('les sources supplémentaires sont validées et filtrables',()=>{
  assert.equal(isPlayableSource({source:'onf',playbackUrl:'https://www.onf.ca/film/un_voyage/embed/player/'}),true);
  assert.equal(isPlayableSource({source:'onf',playbackUrl:'https://evil.test/film/un_voyage/embed/player/'}),false);
  assert.equal(isPlayableSource({source:'dailymotion',videoId:'x123abc'}),true);
  const filters={status:'all',topic:'all',language:'fr',date:'all',source:'dailymotion'};
  assert.equal(filterCatalog([normalizeDailymotion(dm(),{name:'imineo'},date)],filters).length,1);
});

test('le catalogue livré contient uniquement des films français complets et des lecteurs pris en charge',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../public/data/catalog.json',import.meta.url),'utf8'));
  assert.ok(catalog.videos.length>100);
  assert.equal(new Set(catalog.videos.map(v=>v.id)).size,catalog.videos.length);
  for(const film of catalog.videos){
    assert.equal(film.language,'fr',film.id);
    assert.ok(isFeature(film.title,film.durationSeconds,{trustedFilmCatalog:true}),film.id);
    assert.ok(isPlayableMovie(film),film.id);
    assert.equal(getPlayableSources(film).length,film.playbackSources.length,film.id);
    assert.ok(film.languageEvidence,film.id);
  }
});
