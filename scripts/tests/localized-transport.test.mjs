import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Api} from '../../src/renderer/src/api.ts';
import {LANGUAGES,configureLocalization,defaultLocalization} from '../../src/shared/localization/index.ts';
import {parseResponse,setRequestTransport} from '../../src/shared/requests.ts';
setRequestTransport((input,init)=>fetch(input,init));
test('changing UI language never translates authorization, routes or request payloads',async(context)=>{
 const fetch=context.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:200}));
 try{for(const language of LANGUAGES){configureLocalization({...defaultLocalization(),language});const api=new Api('https://fixture.test','synthetic-token');await api.post('/users/@me',{displayName:'Salvar',bio:'Cancelar',content:'Annoy'});const call=fetch.mock.calls.at(-1).arguments;assert.equal(call[0],'https://fixture.test/api/users/@me');assert.equal(call[1].headers.authorization,'Bearer synthetic-token');assert.deepEqual(JSON.parse(call[1].body),{displayName:'Salvar',bio:'Cancelar',content:'Annoy'});}}
 finally{configureLocalization(defaultLocalization());}
});
test('unknown remote errors retain status/code with understandable localized fallback',async()=>{
 try{configureLocalization({...defaultLocalization(),language:'ja'});await assert.rejects(parseResponse(new Response(JSON.stringify({message:'Unknown raw server detail',error:'CUSTOM'}),{status:409})),error=>error.status===409&&error.code==='CUSTOM'&&!error.message.includes('Unknown raw'));}
 finally{configureLocalization(defaultLocalization());}
});
