import {after, beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {updateMessagePins} from '../../src/shared/message-pins.ts';
import {dmKeyPair, conversationKey, sealMessage} from '../../src/renderer/src/social/dm-crypto.ts';
import {setRequestTransport} from '../../src/shared/requests.ts';

// Exercise the real channel and encrypted-DM controllers without Electron,
// sockets or account credentials. Only their UI, gateway and persistence ports are replaced.
const h={state:{view:{kind:'news'},instances:{},social:{threads:{},dms:[],profiles:{}}},runtime:{me:'alice',generation:0},mocks:[],records:new Map(),pins:new Map(),identity:new Uint8Array(32).fill(7)};
globalThis.__annoyPinTests=h;
const stubs=new Map();
function stub(path,exports){
  const id=h.mocks.push(exports)-1;
  stubs.set(new URL(`../../src/renderer/src/${path}`,import.meta.url).href,
    Object.keys(exports).map(name=>`export const ${name}=globalThis.__annoyPinTests.mocks[${id}][${JSON.stringify(name)}];`).join('\n'));
}
const noop=()=>{};
stub('store.ts',{getState:()=>h.state,setState:recipe=>recipe(h.state),subscribe:noop,toast:noop,emptyInstance:()=>({status:'ready',messages:{},servers:[],serverStates:{},connection:{},unread:{}})});
stub('gateway.ts',{Gateway:class {constructor(_url,_token,event){h.event=event;}connect(){}close(){}}});
stub('lib/navigation-guard.ts',{requestNavigation:run=>run()});
stub('features/channels/events.ts',{emitRoomEvent:noop});
stub('format.tsx',{previewText:value=>value});
stub('perms.ts',{displayNameOf:()=>''});
stub('lib/devices.ts',{savedDevice:noop});
stub('voice.ts',{VoiceSession:class {}});
stub('voice-cloudflare.ts',{CloudflareVoiceSession:class {}});
stub('lib/voice-feedback.ts',{playStreamFeedback:noop,playCallFeedback:noop,playVoiceFeedback:noop,playMessageFeedback:noop});
stub('lib/notification-preferences.ts',{isMessageMuted:()=>false,notificationKey:(a,b)=>`${a}:${b}`});
stub('lib/screen-profile.ts',{screenProfile:noop});
stub('features/direct-calls.ts',{handleDirectCallEvent:noop,updateDirectCallMute:noop,disconnectDirectCall:noop,callAction:noop});
stub('chat-state.ts',{clearAccountChatState:noop,clearChatAnchor:noop,clearRecoveryReturn:noop,flushChatState:noop,readChatAnchor:()=>null,readRecoveryReturn:()=>null});
stub('social/runtime.ts',{runtime:h.runtime,social:()=>h.state.social,setSocial:recipe=>recipe(h.state.social),cloudDevice:()=> 'synthetic-device-123456',displayName:p=>p?.username??''});
stub('auth/session.ts',{accountIdentityKey:()=>h.identity});
stub('social/cloud.ts',{cloud:(...args)=>h.cloud(...args),cloudFetch:()=>{throw Error('Unexpected file download');}});
stub('social/local-db.ts',{
 getMessage:async(_me,id)=>h.records.get(id),putMessages:async(_me,items)=>{for(const m of items)h.records.set(m.id,m);},
 getPins:async(_me,id)=>h.pins.get(id)??[],putPins:async(_me,id,pins)=>{h.pins.set(id,structuredClone(pins));},
 recentMessages:async()=>[],getFile:async()=>undefined,putFile:async()=>{},deleteMessage:async(_me,id)=>h.records.delete(id)
});
const hooks=registerHooks({
 resolve(specifier,context,next){const url=context.parentURL&&specifier.startsWith('.')?new URL(specifier,context.parentURL).href:null;return url&&stubs.has(url)?{url,shortCircuit:true}:next(specifier,context);},
 load(url,context,next){return stubs.has(url)?{format:'module',source:stubs.get(url),shortCircuit:true}:next(url,context);}
});
globalThis.window={addEventListener:noop};
globalThis.localStorage={getItem:()=>null,setItem:noop};
const client=await import('../../src/renderer/src/client.ts');
const dms=await import('../../src/renderer/src/social/dms.ts');
setRequestTransport((...args)=>h.transport(...args));
client.connectAccount({id:'account',url:'https://synthetic.test',token:'synthetic',userId:'alice'});
after(()=>{hooks.deregister();delete globalThis.__annoyPinTests;});
const message={id:'000000000001',channelId:'channel',author:{id:'alice'},content:'Pinned content',attachments:[]};
const pin={message,pinnedBy:{id:'alice'},pinnedAt:'2026-11-10T12:00:00.000Z'};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
beforeEach(()=>{
 h.state.instances.account={status:'ready',instance:{messagePins:true,historyWindow:true},connection:{},messages:{channel:{items:[message],loading:false,hasMore:false,pins:[]}},serverStates:{server:{}},unread:{}};
 h.state.view={kind:'server',accountId:'account',serverId:'server',channelId:'channel'};
 h.state.social={threads:{dm:{items:[],loaded:true,hasMoreRemote:false}},dms:[{id:'dm',recipientId:'bob'}],profiles:{}};
 h.state.accounts=[];h.state.settings={};h.state.access={allowed:true};h.records.clear();h.pins.clear();h.runtime.me='alice';h.runtime.generation++;
 h.transport=async()=>Response.json({items:[],nextCursor:null});h.cloud=async()=>[];
 dms.resetDms();
});

test('pin and unpin apply their HTTP result without needing a gateway echo or a second GET',async()=>{
 const requests=[];
 h.transport=async(_url,init)=>{requests.push(init.method);return Response.json(init.method==='PUT'?pin:{});};
 await client.setMessagePinned('account','channel',message.id,true);
 assert.deepEqual(h.state.instances.account.messages.channel.pins,[pin]);
 await client.setMessagePinned('account','channel',message.id,false);
 assert.deepEqual(h.state.instances.account.messages.channel.pins,[]);
 assert.deepEqual(requests,['PUT','DELETE']);
});
test('a stale pins GET cannot undo a completed pin; refresh includes other pins too',async()=>{
 const stale=deferred(),other={...pin,message:{...message,id:'000000000002'}};
 let reads=0;
 h.transport=async(_url,init)=>init.method==='PUT'?Response.json(pin):++reads===1?stale.promise:Response.json({items:[other,pin],nextCursor:null});
 const loading=client.loadPinnedMessages('account','channel');await flush();
 await client.setMessagePinned('account','channel',message.id,true);await flush();
 stale.resolve(Response.json({items:[],nextCursor:null}));await loading;await flush();
 assert.deepEqual(h.state.instances.account.messages.channel.pins,[other,pin]);
 assert.equal(h.state.instances.account.messages.channel.pinsLoading,false);
});
test('opening pinned context repeatedly preserves pins and still allows unpinning',async()=>{
 h.state.instances.account.messages.channel.pins=[pin];
 h.transport=async(_url,init)=>Response.json(init.method==='DELETE'?{}:{items:[message],hasMoreBefore:true,hasMoreAfter:true});
 await client.jumpToMessage('account','channel',message.id,'server');
 await client.jumpToMessage('account','channel',message.id,'server');
 assert.deepEqual(h.state.instances.account.messages.channel.pins,[pin]);
 await client.setMessagePinned('account','channel',message.id,false);
 assert.deepEqual(h.state.instances.account.messages.channel.pins,[]);
});
test('a later shared unpin wins over a delayed pin HTTP response',async()=>{
 const pending=deferred();h.transport=()=>pending.promise;
 const write=client.setMessagePinned('account','channel',message.id,true);await flush();
 h.event({t:'CHANNEL_PIN_UPDATE',d:{channelId:'channel',messageId:message.id,message:null}});
 pending.resolve(Response.json(pin));await write;
 assert.deepEqual(h.state.instances.account.messages.channel.pins,[]);
});
test('pin request failures keep the previous state and remain visible to the caller',async()=>{
 h.state.instances.account.messages.channel.pins=[pin];
 h.transport=async()=>Response.json({message:'Forbidden'},{status:403});
 await assert.rejects(client.setMessagePinned('account','channel',message.id,false),{status:403});
 assert.deepEqual(h.state.instances.account.messages.channel.pins,[pin]);
});
test('a late pins page cannot undo a live edit of its message',async()=>{
 const pending=deferred();h.transport=()=>pending.promise;
 const loading=client.loadPinnedMessages('account','channel');await flush();
 h.event({t:'MESSAGE_UPDATE',d:{...message,content:'Edited while loading'}});
 pending.resolve(Response.json({items:[pin],nextCursor:null}));await loading;
 assert.equal(h.state.instances.account.messages.channel.pins[0].message.content,'Edited while loading');
});
test('channel loading includes the 100th pin so it can be removed, not pinned again',async()=>{
 const pins=Array.from({length:100},(_,i)=>({...pin,message:{...message,id:String(i).padStart(12,'0')}}));
 h.transport=async url=>{assert.match(url,/limit=100/);return Response.json({items:pins,nextCursor:null});};
 await client.loadPinnedMessages('account','channel');
 assert.equal(h.state.instances.account.messages.channel.pins.length,100);
});
test('pin state stays unique, bounded and in cursor order',()=>{
 const older={...pin,message:{...message,id:'000000000000'}};
 assert.deepEqual(updateMessagePins([pin],older.message.id,older),[pin,older]);
 assert.deepEqual(updateMessagePins([pin],message.id,pin),[pin]);
 assert.deepEqual(updateMessagePins([pin],message.id,null),[]);
});

async function encryptedPin(){
 const mine=await dmKeyPair(h.identity),other=await dmKeyPair(new Uint8Array(32).fill(8));
 h.state.social.profiles.bob={id:'bob',username:'bob',dmKey:other.publicKey};
 const context={conversationId:'dm',senderId:'bob',clientId:'client-bob-12345'};
 const sealed=await sealMessage(await conversationKey(mine,'alice',other.publicKey,'bob'),context,{v:1,content:'End-to-end encrypted pin'});
 const stored={...context,id:'encrypted-message',...sealed,createdAt:'2026-11-10T12:00:00.000Z',editedAt:null};
 return {message:stored,pinnedBy:'bob',pinnedAt:stored.createdAt};
}
test('shared DM pins decrypt only in memory, persist sealed, and can pin the other person’s message',async()=>{
 const sealed=await encryptedPin();h.records.set(sealed.message.id,sealed.message);
 const requests=[];
 h.cloud=async(service,path,init)=>{requests.push({service,path,init});return [sealed];};
 await dms.loadDmPins('dm');
 const decoded=h.state.social.threads.dm.pins[0].message;
 assert.equal(decoded.content,'End-to-end encrypted pin');
 assert.equal(JSON.stringify(h.pins.get('dm')).includes(decoded.content),false);
 await dms.setDmPinned(decoded,true);
 const put=requests.find(r=>r.init?.method==='PUT');
 assert.equal(put.init.body.ciphertext,sealed.message.ciphertext);
 assert.equal('content' in put.init.body,false);
 await dms.setDmPinned(decoded,false);
 assert.ok(requests.some(r=>r.init?.method==='DELETE'));
});
test('DM reconnect refresh rejects stale results and retains cached pins when offline',async()=>{
 const sealed=await encryptedPin(),stale=deferred();
 h.cloud=()=>stale.promise;
 const first=dms.loadDmPins('dm');await flush();
 h.cloud=async()=>[sealed];await dms.loadDmPins('dm');
 stale.resolve([]);await first;
 assert.equal(h.state.social.threads.dm.pins.length,1);
 delete h.state.social.threads.dm.pins;
 h.cloud=async()=>{throw Error('offline');};await dms.loadDmPins('dm');
 assert.equal(h.state.social.threads.dm.pins[0].message.content,'End-to-end encrypted pin');
 assert.equal(h.state.social.threads.dm.pinsError,'offline');
 assert.equal(h.state.social.threads.dm.pinsLoading,false);
});
test('a DM pin request completing after sign out cannot change the next account',async()=>{
 const sealed=await encryptedPin(),wait=deferred();h.cloud=()=>wait.promise;
 const loading=dms.loadDmPins('dm');await flush();
 h.runtime.generation++;h.runtime.me='different-account';h.state.social.threads={};
 wait.resolve([sealed]);await loading;
 assert.deepEqual(h.state.social.threads,{});
 assert.equal(h.pins.size,0);
});
