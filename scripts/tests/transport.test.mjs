import {test} from 'node:test';
import assert from 'node:assert/strict';
import {secureHttpUrl} from '../../src/shared/transport.ts';
import {secureFetch} from '../../src/renderer/src/secure-fetch.ts';
test('remote transport requires HTTPS and only explicit loopback permits HTTP',()=>{
 for(const url of ['https://example.test','http://127.0.0.1:1234','http://localhost:1234','http://[::1]:1234'])assert.ok(secureHttpUrl(url));
 for(const url of ['http://example.test','http://192.168.0.1','http://0.0.0.0','https://user:password@example.test','file:///tmp/test','not a url'])assert.throws(()=>secureHttpUrl(url));
});
test('renderer rejects plaintext credentials before fetch and prohibits redirects',async()=>{
 const previous={fetch:globalThis.fetch,window:globalThis.window,location:globalThis.location};let requests=0,options;
 globalThis.window={};globalThis.location={href:'https://client.test/'};globalThis.fetch=async(_input,init)=>{requests++;options=init;return Response.json({ok:true});};
 try{
  await assert.rejects(secureFetch('http://remote.test/api/auth/login',{method:'POST',body:'sensitive password'}),/HTTPS/);
  await assert.rejects(secureFetch('http://remote.test/api/users/@me',{headers:{authorization:'Bearer sensitive-token'}}),/HTTPS/);assert.equal(requests,0);
  await secureFetch('https://remote.test/api/auth/login',{method:'POST',body:'synthetic',redirect:'follow'});assert.equal(options.redirect,'error');assert.equal(requests,1);
 }finally{Object.assign(globalThis,previous);}
});
test('DPoP retries retain Request method and cannot enable redirects',async()=>{
 const previous={fetch:globalThis.fetch,window:globalThis.window,location:globalThis.location},proofs=[],requests=[];
 globalThis.window={distopic:{crypto:{proof:async(...args)=>{proofs.push(args);return 'synthetic-proof';}}}};globalThis.location={href:'https://client.test/'};
 globalThis.fetch=async(_input,init)=>{requests.push(init);return requests.length===1?Response.json({},{status:401,headers:{'dpop-nonce':'n'.repeat(43)}}):Response.json({ok:true});};
 try{
  const request=new Request('https://remote.test/api/resource',{method:'PATCH',headers:{authorization:'Bearer synthetic-token'},body:'synthetic'});
  await secureFetch(request,{redirect:'follow'});assert.equal(requests.length,2);assert.ok(requests.every(init=>init.redirect==='error'&&init.headers.get('authorization')==='DPoP synthetic-token'));
  assert.deepEqual(proofs.map(args=>args[2]),['PATCH','PATCH']);assert.equal(proofs[1][4],'n'.repeat(43));
 }finally{Object.assign(globalThis,previous);}
});
