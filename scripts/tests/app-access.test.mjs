import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppAccess } from '../../src/main/app-access.ts';

const profile = { id:'g',name:'Global',email:'g@example.com' };
const local = { id:'a',url:'https://local.test',token:'local-token',userId:'u' };
const response = (body,status=200) => Response.json(body,{status});

test('startup is locked and invalid global credentials cannot grant access',async()=>{
  const access = createAppAccess('https://global.test',()=>{},async()=>response({},401));
  assert.equal(access.getState().allowed,false);
  await assert.rejects(access.verifyGlobal('invalid'));
  assert.equal(access.getState().allowed,false);
});
test('global logout revokes access synchronously and a delayed login cannot restore it',async()=>{
  let complete;
  let fetcher=async()=>response(profile);
  const access = createAppAccess('https://global.test',()=>{},(...args)=>fetcher(...args));
  await access.verifyGlobal('valid'); assert.equal(access.getState().allowed,true);
  fetcher=()=>new Promise(resolve=>{complete=resolve;});
  const pending=access.verifyGlobal('pending');
  access.revokeGlobal(); assert.equal(access.getState().allowed,false);
  complete(response(profile)); await assert.rejects(pending);
  assert.equal(access.getState().allowed,false);
});
test('only an explicitly local host with a valid matching account grants the exception',async()=>{
  for(const [mode,status,id] of [['global',200,'u'],[undefined,200,'u'],['local',401,'u'],['local',200,'wrong']]){
    const access=createAppAccess('https://global.test',()=>{},async url=>url.endsWith('/info')?response({accountMode:mode}):response({id},status));
    await assert.rejects(access.verifyLocal(local)); assert.equal(access.getState().allowed,false);
  }
  const access=createAppAccess('https://global.test',()=>{},async url=>url.endsWith('/info')?response({accountMode:'local'}):response({id:'u',global:false}));
  await access.verifyLocal(local); assert.equal(access.getState().allowed,true);
  access.revokeGlobal(); assert.equal(access.getState().allowed,true);
  access.revokeLocal('a'); assert.equal(access.getState().allowed,false);
});
test('removing a local account during validation cancels any late access grant',async()=>{
  let complete;
  const access=createAppAccess('https://global.test',()=>{},async url=>url.endsWith('/info')?response({accountMode:'local'}):new Promise(resolve=>{complete=resolve;}));
  const pending=access.verifyLocal(local);
  await new Promise(r=>setImmediate(r));
  access.revokeLocal('a'); complete(response({id:'u'}));
  await assert.rejects(pending); assert.equal(access.getState().allowed,false);
});
test('expired global sessions and changed local policies revoke access during revalidation',async()=>{
  let expired=false;
  const access=createAppAccess('https://global.test',()=>{},async url=>{
    if(url.endsWith('/v1/me'))return response(profile,expired?401:200);
    return url.endsWith('/info')?response({accountMode:expired?'global':'local'}):response({id:'u'});
  });
  await access.verifyGlobal('global-token'); await access.verifyLocal(local);
  expired=true; await access.revalidate();
  assert.equal(access.getState().allowed,false);
});

test('native credential verification rejects remote HTTP before any request',async()=>{
 let requests=0;const access=createAppAccess('http://global.test',()=>{},async()=>{requests++;return response(profile);});
 await assert.rejects(access.verifyGlobal('sensitive-token'),/HTTPS/);
 await assert.rejects(access.verifyLocal({...local,url:'http://local.test'}),/HTTPS/);
 assert.equal(requests,0);assert.equal(access.getState().allowed,false);
});
