import {spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync} from 'node:fs';
const command=process.env.CARGO||'cargo';
const run=(program,args,what)=>{
 const result=spawnSync(program,args,{stdio:'inherit'});
 if(result.error)throw new Error(what+': '+result.error.message);
 if(result.status)process.exit(result.status);
};
run(command,['build','--release','--locked','--manifest-path','native/annoy-crypto/Cargo.toml'],'Rust/Cargo is required to build the OpenMLS service');
// SFrame (RFC 9605) for the renderer's encoded-transform worker. wasm-bindgen only rewrites
// the module's imports; the worker loads the raw exports itself.
run(command,['build','--release','--locked','--target','wasm32-unknown-unknown','--manifest-path','native/annoy-sframe/Cargo.toml'],'The wasm32-unknown-unknown target is required to build SFrame');
const out='native/annoy-sframe/target/bindgen';
run(process.env.WASM_BINDGEN||'wasm-bindgen',['--target','web','--no-typescript','--out-dir',out,'native/annoy-sframe/target/wasm32-unknown-unknown/release/annoy_sframe.wasm'],'wasm-bindgen-cli 0.2.130 is required to build SFrame');
mkdirSync('src/renderer/src/media-e2ee/generated',{recursive:true});
copyFileSync(out+'/annoy_sframe_bg.wasm','src/renderer/src/media-e2ee/generated/annoy_sframe.wasm');
