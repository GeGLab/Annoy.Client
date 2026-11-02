import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

const path=new URL('../../src/renderer/src/media-e2ee/generated/annoy_sframe.wasm',import.meta.url);
test('the shipped SFrame WASM authenticates video, rejects altered ciphertext and rejects exact replays',async(t)=>{
 if(!existsSync(path)){if(process.env.ANNOY_REQUIRE_NATIVE==='1')assert.fail('Build the SFrame WASM before mandatory native validation');t.skip('SFrame WASM is not built');return;}
 const module=await WebAssembly.compile(readFileSync(path)),key=randomBytes(32);
 const session=async(index)=>{
  let wasm;const imports={};
  for(const entry of WebAssembly.Module.imports(module)){
   assert.equal(entry.name,'__wbindgen_init_externref_table');
   imports[entry.module]={[entry.name]:()=>{const table=wasm.__wbindgen_externrefs;for(const [at,value]of [[0,undefined],[1024,undefined],[1025,null],[1026,true],[1027,false]])table.set(at,value);}};
  }
  wasm=(await WebAssembly.instantiate(module,imports)).exports;wasm.__wbindgen_start?.();
  const input=(bytes,run)=>{const ptr=wasm.sf_alloc(bytes.length);new Uint8Array(wasm.memory.buffer,ptr,bytes.length).set(bytes);try{return run(ptr,bytes.length);}finally{wasm.sf_free(ptr,bytes.length);}};
  assert.equal(input(key,(ptr,len)=>wasm.sf_set_epoch(0,7,index,ptr,len)),0);
  const transform=(bytes,run)=>input(bytes,(ptr,len)=>{const size=run(ptr,len);if(size<0)return size;const result=Buffer.from(new Uint8Array(wasm.memory.buffer,wasm.sf_output(),size));wasm.sf_wipe_output();return result;});
  return {seal:bytes=>transform(bytes,(ptr,len)=>wasm.sf_encrypt(1,ptr,len,10)),open:bytes=>transform(bytes,(ptr,len)=>wasm.sf_decrypt(ptr,len,10)),close:()=>wasm.sf_clear()};
 };
 const [sender,receiver]=await Promise.all([session(0),session(1)]);
 try{
  const frame=Buffer.concat([Buffer.from([0x10,2,0,0x9d,1,0x2a,0x80,2,0xe0,1]),Buffer.from('synthetic encoded-video canary')]);
  const sealed=sender.seal(frame);assert.ok(Buffer.isBuffer(sealed));assert.deepEqual(sealed.subarray(0,10),frame.subarray(0,10));
  assert.deepEqual(receiver.open(sealed),frame);assert.equal(receiver.open(sealed),-7,'The same authenticated frame must never open twice');
  const altered=sender.seal(frame);altered[altered.length-1]^=1;
  assert.equal(receiver.open(altered),-6,'A changed authentication tag must be rejected');
 }finally{sender.close();receiver.close();key.fill(0);}
});
