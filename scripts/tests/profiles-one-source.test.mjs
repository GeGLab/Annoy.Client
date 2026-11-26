import {after, test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

// social/profiles.ts: an Annoy account's profile comes only from usersannoy; the minimal local
// cache follows every change and is read only while the cloud gives no answer at all.
const h={state:{instances:{},social:{profiles:{}}},listeners:new Set(),reachable:true,mocks:[],storage:new Map(),batches:[]};
globalThis.__annoyProfileTests=h;
const stubs=new Map();
function stub(path,exports){
  const id=h.mocks.push(exports)-1;
  stubs.set(new URL(`../../src/renderer/src/${path}`,import.meta.url).href,
    Object.keys(exports).map(name=>`export const ${name}=globalThis.__annoyProfileTests.mocks[${id}][${JSON.stringify(name)}];`).join('\n'));
}
const noop=()=>{};
const notify=()=>{for(const l of h.listeners)l();};
stub('store.ts',{getState:()=>h.state,subscribe:l=>(h.listeners.add(l),()=>h.listeners.delete(l)),useStore:selector=>selector(h.state)});
stub('social/cloud.ts',{cloud:async(_s,_p,init)=>{h.batches.push(init.body.ids);return{users:[]};},cloudReachable:()=>h.reachable,onCloudReachability:()=>noop,imageUrl:id=>id?`https://cdn.test/i/${id}`:null});
stub('social/runtime.ts',{setSocial:recipe=>{h.state={...h.state,social:{...h.state.social,profiles:{...h.state.social.profiles}}};recipe(h.state.social);notify();}});
const hooks=registerHooks({
 resolve(specifier,context,next){const url=context.parentURL&&specifier.startsWith('.')?new URL(specifier,context.parentURL).href:null;return url&&stubs.has(url)?{url,shortCircuit:true}:next(specifier,context);},
 load(url,context,next){return stubs.has(url)?{format:'module',source:stubs.get(url),shortCircuit:true}:next(url,context);}
});
globalThis.localStorage={getItem:key=>h.storage.get(key)??null,setItem:(key,value)=>h.storage.set(key,value)};
const {personOf}=await import('../../src/renderer/src/social/profiles.ts');
after(()=>{hooks.deregister();delete globalThis.__annoyProfileTests;});

const serverUser={id:'server-id',annoyId:'UA0000000001'};
const profile=(displayName)=>({id:'UA0000000001',username:'zeca',displayName,bio:'oi',avatar:'photo',banner:null,accentColor:null,dmKey:null,dmKeyVersion:null});
const setProfiles=profiles=>{h.state={...h.state,social:{...h.state.social,profiles}};notify();};
const flushCache=()=>new Promise(resolve=>setTimeout(resolve,350));

test('an Annoy account shows only its usersannoy profile; local accounts their server profile', ()=>{
  assert.equal(personOf(serverUser).displayName,'','nothing from the server while the profile has not arrived');
  setProfiles({UA0000000001:profile('Zeca')});
  assert.deepEqual(personOf(serverUser),{id:'server-id',username:'zeca',displayName:'Zeca',avatarUrl:'https://cdn.test/i/photo',bio:'oi'});
  assert.deepEqual(personOf({id:'l',username:'carla',profile:{displayName:'Carla',avatarUrl:null,bio:''}}),{id:'l',username:'carla',displayName:'Carla',avatarUrl:null,bio:''});
});

test('every change updates the cache; it is read only while the cloud does not answer at all', async()=>{
  setProfiles({UA0000000001:profile('Zeca novo')});
  await flushCache();
  assert.match(h.storage.get('annoy.profileCache.v1'),/Zeca novo/,'the change reached the cache at once');
  setProfiles({});
  h.reachable=true;
  assert.equal(personOf(serverUser).displayName,'','with the cloud answering, the cache is not read');
  h.reachable=false;
  assert.equal(personOf(serverUser).displayName,'Zeca novo','without any answer, the last cached profile');
});
