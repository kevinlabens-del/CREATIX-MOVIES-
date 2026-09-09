import assert from 'node:assert/strict';
import test from 'node:test';
import {loadPlayer,clearPlayer} from '../src/player.js';

// A minimal event-driven DOM exercises player lifecycle and failure handling
// without pretending that a remote iframe actually played a movie.
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.listeners=new Map();this.attrs={};this.contentWindow={postMessage(){}};}
  replaceChildren(...nodes){this.children=nodes;}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(name,value){this.attrs[name]=value;}
  removeAttribute(name){delete this.attrs[name];}
  addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
  removeEventListener(name,callback){this.listeners.get(name)?.delete(callback);}
  emit(name,event={}){for(const fn of [...(this.listeners.get(name)||[])])fn(event);}
  pause(){}
  load(){}
  play(){return Promise.resolve();}
  canPlayType(){return '';}
}
function environment(){
  const win=new Element('window');win.location={protocol:'https:',origin:'https://example.test'};
  globalThis.window=win;
  globalThis.document={baseURI:new URL('../',import.meta.url).href,createElement:tag=>new Element(tag)};
  return {container:new Element('div'),win};
}
const sourceA={source:'youtube',videoId:'abcdefghijk',embeddable:true};
const sourceB={source:'youtube',videoId:'ABCDEFGHIJK',embeddable:true};

test('une erreur vidéo native essaie la source suivante et les événements anciens ne la remplacent pas',async()=>{
  const {container}=environment();const events=[];
  await loadPlayer(container,{title:'Film',playbackSources:[{source:'mp4',playbackUrl:'https://example.test/movie.mp4'},sourceA]},false,{onChange:event=>events.push(event.state)});
  const video=container.children[0];assert.equal(video.tag,'video');
  assert.deepEqual(events,['mounted']);
  video.emit('error');const frame=container.children[0];assert.equal(frame.tag,'iframe');
  assert.match(frame.src,/youtube-nocookie/);video.emit('error');assert.equal(container.children[0],frame);
  clearPlayer(container);assert.equal(container.children.length,0);
});

test('les messages YouTube sont acceptés uniquement depuis le lecteur monté et son origine',async()=>{
  const {container,win}=environment();
  await loadPlayer(container,{title:'Film',playbackSources:[sourceA,sourceB]},false);
  const frame=container.children[0];
  const data=JSON.stringify({event:'onError',info:150});
  win.emit('message',{data,source:frame.contentWindow,origin:'https://evil.test'});assert.equal(container.children[0],frame);
  win.emit('message',{data,source:{},origin:'https://www.youtube-nocookie.com'});assert.equal(container.children[0],frame);
  win.emit('message',{data,source:frame.contentWindow,origin:'https://www.youtube-nocookie.com'});
  assert.notEqual(container.children[0],frame);assert.match(container.children[0].src,/ABCDEFGHIJK/);
  clearPlayer(container);assert.equal(win.listeners.get('message').size,0);
});

test('un import HLS tardif ne remplace pas le film choisi entre-temps',async()=>{
  const {container}=environment();
  const first=loadPlayer(container,{title:'HLS lent',playbackSources:[{source:'hls',playbackUrl:'https://example.test/movie.m3u8'},sourceB]},false);
  await loadPlayer(container,{title:'Nouveau film',playbackSources:[sourceA]},false);
  const current=container.children[0];
  await first;
  assert.equal(container.children[0],current);assert.match(current.src,/abcdefghijk/);
  clearPlayer(container);
});
