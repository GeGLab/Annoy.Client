import {t as translate} from "../../shared/localization/index.ts";
import {randomBytes} from 'node:crypto';
import sodium from 'libsodium-wrappers-sumo';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {seal,open,type KeyProtector} from './vault.ts';
interface OsStorage {available():boolean;encrypt(value:string):Buffer;decrypt(value:Buffer):string}

/** Password fallback is explicit and memory-only; master keys remain encrypted on disk. */
export class VaultKeyProtector implements KeyProtector {
 private directory:string;private os:OsStorage;private passwordKey:Buffer|null=null;
 constructor(directory:string,os:OsStorage){this.directory=directory;this.os=os;}
 available(){return this.os.available()||!!this.passwordKey;}
 async unlockPassword(password:string):Promise<void>{
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
  this.passwordKey?.fill(0);this.passwordKey=key;
 }
 lock(){this.passwordKey?.fill(0);this.passwordKey=null;}
 seal(key:Buffer):Buffer {
  if(this.os.available())return Buffer.from(JSON.stringify({v:1,mode:'os',data:this.os.encrypt(key.toString('base64')).toString('base64')}));
  if(!this.passwordKey)throw new Error('Desbloqueie o armazenamento com uma senha local');
  return Buffer.from(JSON.stringify({v:1,mode:'password',data:seal(this.passwordKey,key,'password-master').toString('base64')}));
 }
 open(sealed:Buffer):Buffer {
  const saved=JSON.parse(sealed.toString('utf8')) as {v:number;mode:string;data:string};
  if(saved.v!==1 || typeof saved.data!=='string')throw new Error('Invalid local key format');
  if(saved.mode==='os'){
   if(!this.os.available())throw new Error(translate("common.ec437ffc4604"));
   return Buffer.from(this.os.decrypt(Buffer.from(saved.data,'base64')),'base64');
  }
  if(saved.mode!=='password' || !this.passwordKey)throw new Error('Desbloqueie o armazenamento com uma senha local');
  try{return open(this.passwordKey,Buffer.from(saved.data,'base64'),'password-master');}catch{this.lock();throw new Error('Senha local incorreta');}
 }
}
