import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {authenticateUpdate,signedUpdatePayload,verifyUpdateFile,matchUpdateMetadata,fetchUpdateManifest,updateManifestUrl} from '../../src/main/update-signature.ts';
test('signed updates reject a substituted signer, artifact, version, platform, metadata and missing trust',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'annoy-update-signature-'));
 const pair=generateKeyPairSync('ed25519'),keys={release:pair.publicKey.export({format:'pem',type:'spki'}).toString()},expected={version:'0.9.0',platform:'linux',arch:'x64'};
 const bytes=Buffer.from('synthetic installer'),raw={format:1,keyId:'release',...expected,filename:'Annoy-x86_64.AppImage',size:bytes.length,sha512:createHash('sha512').update(bytes).digest('base64')};
 const signed={...raw,signature:sign(null,signedUpdatePayload(raw),pair.privateKey).toString('base64url')};
 try{
  const manifest=authenticateUpdate(signed,keys,expected),file=join(directory,'installer');await writeFile(file,bytes);await verifyUpdateFile(file,manifest);
  assert.throws(()=>authenticateUpdate(signed,{},expected));
  assert.throws(()=>authenticateUpdate({...signed,size:signed.size+1},keys,expected));
  assert.throws(()=>authenticateUpdate(signed,{release:generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'}).toString()},expected));
  assert.throws(()=>authenticateUpdate(signed,keys,{...expected,version:'0.10.0'}));
  assert.throws(()=>authenticateUpdate(signed,keys,{...expected,platform:'win32'}));
  assert.throws(()=>authenticateUpdate({...signed,filename:'../escape'},keys,expected));
  matchUpdateMetadata(manifest,{version:raw.version,files:[{url:raw.filename,sha512:raw.sha512,size:raw.size}]});
  assert.throws(()=>matchUpdateMetadata(manifest,{version:raw.version,files:[{url:'other.exe',sha512:raw.sha512}]}));
  await writeFile(file,Buffer.alloc(bytes.length));await assert.rejects(verifyUpdateFile(file,manifest));
  if(process.platform!=='win32'){await writeFile(file,bytes);await symlink('installer',join(directory,'linked'));await assert.rejects(verifyUpdateFile(join(directory,'linked'),manifest));}
  assert.throws(()=>updateManifestUrl('http://remote.test/',expected));
  assert.throws(()=>updateManifestUrl('https://user:secret@example.test/',expected));
  const url=updateManifestUrl('https://example.test/releases',expected);assert.equal(url.pathname,'/releases/annoy-linux-x64-0.9.0.signed.json');
  const result=await fetchUpdateManifest('http://127.0.0.1/',expected,async()=>new Response(JSON.stringify(signed)));assert.deepEqual(result,signed);
  await assert.rejects(fetchUpdateManifest('https://example.test/',expected,async()=>new Response('x'.repeat(16385))));
 }finally{await rm(directory,{recursive:true,force:true});}
});
