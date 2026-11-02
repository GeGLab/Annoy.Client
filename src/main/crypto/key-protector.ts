import {t as translate} from "../../shared/localization/index.ts";
import {randomBytes} from 'node:crypto';
import sodium from 'libsodium-wrappers-sumo';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {seal,open,type KeyProtector} from './vault.ts';
import type {OsStorage} from '../safe-storage.ts';

/** Password fallback is explicit and memory-only; master keys remain encrypted on disk. */
export class VaultKeyProtector implements KeyProtector {
 private directory:string;private os:OsStorage;private passwordKey:Buffer|null=null;private rotation=false;private epoch=0;
 constructor(directory:string,os:OsStorage){this.directory=directory;this.os=os;}
 async available(){return await this.os.available()||!!this.passwordKey;}
 shouldReEncrypt(){return this.rotation;}
 async unlockPassword(password:string):Promise<void>{
  const epoch=this.epoch;
  if(password.length<12 || password.length>256)throw new Error(translate("common.be3b54435a0e"));
  mkdirSync(this.directory,{recursive:true,mode:0o700});const path=join(this.directory,'password-kdf.json');
  let salt:Buffer;
  if(existsSync(path)){
   const saved=JSON.parse(readFileSync(path,'utf8')) as {v:number;salt:string};
   salt=Buffer.from(saved.salt,'base64');if(saved.v!==1 || salt.length!==16)throw new Error('Invalid local KDF parameters');
  }else {salt=randomBytes(16);writeFileSync(path,JSON.stringify({v:1,salt:salt.toString('base64')}),{flag:'wx',mode:0o600});}
  await sodium.ready;
  const derived=sodium.crypto_pwhash(32,password,salt,3,64*1024*1024,sodium.crypto_pwhash_ALG_ARGON2ID13);
  const key=Buffer.from(derived);sodium.memzero(derived);
  if(epoch!==this.epoch){key.fill(0);throw new Error('Vault locked');}
  this.passwordKey?.fill(0);this.passwordKey=key;
 }
 lock(){++this.epoch;this.passwordKey?.fill(0);this.passwordKey=null;this.rotation=false;}
 async seal(key:Buffer):Promise<Buffer> {
  if(await this.os.available())return Buffer.from(JSON.stringify({v:1,mode:'os',data:(await this.os.encrypt(key.toString('base64'))).toString('base64')}));
  if(!this.passwordKey)throw new Error('Desbloqueie o armazenamento com uma senha local');
  return Buffer.from(JSON.stringify({v:1,mode:'password',data:seal(this.passwordKey,key,'password-master').toString('base64')}));
 }
 async open(sealed:Buffer):Promise<Buffer> {
  const saved=JSON.parse(sealed.toString('utf8')) as {v:number;mode:string;data:string};
  if(saved.v!==1 || typeof saved.data!=='string')throw new Error('Invalid local key format');
  if(saved.mode==='os'){
   if(!await this.os.available())throw new Error(translate("common.ec437ffc4604"));
   const value=await this.os.decrypt(Buffer.from(saved.data,'base64'));
   this.rotation=typeof value!=='string'&&value.shouldReEncrypt;
   return Buffer.from(typeof value==='string'?value:value.result,'base64');
  }
  if(saved.mode!=='password' || !this.passwordKey)throw new Error('Desbloqueie o armazenamento com uma senha local');
  try{return open(this.passwordKey,Buffer.from(saved.data,'base64'),'password-master');}catch{this.lock();throw new Error('Senha local incorreta');}
 }
}
