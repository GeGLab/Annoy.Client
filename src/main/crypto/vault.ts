import {t as translate} from "../../shared/localization/index.ts";
import { createCipheriv, createDecipheriv, createHash,hkdfSync, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join,dirname } from 'node:path';

export interface KeyProtector { available(): boolean; seal(key: Buffer): Buffer; open(sealed: Buffer): Buffer }
interface Entry { blob: string; key: Buffer; expiresAt: number | null; backup: boolean }
interface Shard {blob:string;key:Buffer}
interface SavedEntry { blob: string; key: string; expiresAt: number | null; backup: boolean }
const label = (value: string) => Buffer.from('annoy/local-vault/v1\0'+value);
export function seal(key: Buffer, plaintext: Buffer, context: string): Buffer {
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(label(context));
  return Buffer.concat([Buffer.from([1]),nonce,cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
}
export function open(key: Buffer, ciphertext: Buffer, context: string): Buffer {
  if(ciphertext.length<29 || ciphertext[0]!==1) throw new Error('Invalid encrypted record');
  const decipher=createDecipheriv('aes-256-gcm',key,ciphertext.subarray(1,13));decipher.setAAD(label(context));
  decipher.setAuthTag(ciphertext.subarray(-16));
  return Buffer.concat([decipher.update(ciphertext.subarray(13,-16)),decipher.final()]);
}
class VaultWriteError extends Error {readonly committed:boolean;constructor(committed:boolean){super('Encrypted storage commit failed; unlock again before retrying');this.committed=committed;}}
function atomic(path:string,bytes:Buffer) {
  const temporary=path+'.'+randomBytes(12).toString('hex')+'.tmp';let renamed=false;
  try{
    const fd=openSync(temporary,'wx',0o600);
    try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
    renameSync(temporary,path);renamed=true;
    if(process.platform!=="win32"){const directory=openSync(dirname(path),"r");try{fsyncSync(directory);}finally{closeSync(directory);}}
  }catch{try{unlinkSync(temporary);}catch{}throw new VaultWriteError(renamed);}
}
function rootSeal(master:Buffer,plaintext:Buffer):Buffer {
 const salt=randomBytes(32),key=Buffer.from(hkdfSync('sha256',master,salt,'annoy/local-vault/index/v2',32));
 try{return Buffer.concat([Buffer.from([2]),salt,seal(key,plaintext,'index-v2')]);}finally{key.fill(0);}
}
function rootOpen(master:Buffer,ciphertext:Buffer):Buffer {
 if(ciphertext[0]!==2)return open(master,ciphertext,'index');
 if(ciphertext.length<62)throw new Error('Invalid vault index');
 const key=Buffer.from(hkdfSync('sha256',master,ciphertext.subarray(1,33),'annoy/local-vault/index/v2',32));
 try{return open(key,ciphertext.subarray(33),'index-v2');}finally{key.fill(0);}
}
/** Trusted-main-only vault. Protocol snapshots are never included in exported backups. */
export class EncryptedVault {
  private master: Buffer | null=null;
  private entries=new Map<string,Entry>();
  private batchEntries:Entry[]|null=null;
  private shards=new Map<number,Shard>();private dirty=new Set<number>();private buckets=new Map<string,number>();private pinnedBlobs=new Map<string,number>();
  private bucket(id:string):number{let bucket=this.buckets.get(id);if(bucket===undefined){bucket=createHash("sha256").update(id).digest()[0]!;this.buckets.set(id,bucket);}return bucket;}
  private directory:string;
  private protector:KeyProtector;
  constructor(directory:string,protector:KeyProtector) {this.directory=directory;this.protector=protector;}
  exists():boolean {return existsSync(join(this.directory,'master.sealed'));}
  unlock(): void {
    if(this.master) return;
    if(!this.protector.available()) throw new Error('Secure OS storage unavailable; unlock with a supported key protector');
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    const masterPath=join(this.directory,'master.sealed');
    if(existsSync(masterPath)) this.master=this.protector.open(readFileSync(masterPath));
    else {
      if(existsSync(join(this.directory,'index.enc'))) throw new Error('Missing vault key; refusing to overwrite encrypted history');
      this.master=randomBytes(32);atomic(masterPath,this.protector.seal(this.master));
    }
    if(this.master.length!==32) {this.lock();throw new Error('Invalid vault key');}
    try {
      if(existsSync(join(this.directory,'index.enc'))) {
        const plain=rootOpen(this.master,readFileSync(join(this.directory,'index.enc')));
        try{
          const saved=JSON.parse(plain.toString('utf8')) as {version:number;entries?:Record<string,SavedEntry>;shards?:Record<string,{key:string;blob:string}>};
          const load=(entries:Record<string,SavedEntry>,bucket?:number)=>{
            if(!entries||typeof entries!=='object'||Array.isArray(entries))throw new Error('Invalid vault index');
            for(const [id,value] of Object.entries(entries)){
              if(!id||id.length>2048||!value||!/^[a-f0-9]{64}$/.test(value.blob)||typeof value.key!=='string'||(value.expiresAt!==null&&(!Number.isSafeInteger(value.expiresAt)||value.expiresAt<0))||typeof value.backup!=='boolean'||(bucket!==undefined&&this.bucket(id)!==bucket))throw new Error('Invalid vault index');
              const key=Buffer.from(value.key,'base64');if(key.length!==32)throw new Error('Invalid record key');this.entries.set(id,{...value,key});
            }
          };
          if(saved.version===1){load(saved.entries!);for(const id of this.entries.keys())this.dirty.add(this.bucket(id));this.persist();}
          else if(saved.version===2&&saved.shards&&typeof saved.shards==='object'&&!Array.isArray(saved.shards)){
            for(const [id,value] of Object.entries(saved.shards)){
              const bucket=Number(id);if(!Number.isInteger(bucket)||bucket<0||bucket>255||String(bucket)!==id||!value||!/^[a-f0-9]{64}$/.test(value.blob)||typeof value.key!=='string')throw new Error('Invalid key shard');
              const key=Buffer.from(value.key,'base64');if(key.length!==32)throw new Error('Invalid shard key');this.shards.set(bucket,{blob:value.blob,key});
              const bytes=open(key,readFileSync(this.path(value.blob)),'key-shard:'+bucket);
              try{const shard=JSON.parse(bytes.toString('utf8'));if(shard.version!==1||shard.bucket!==bucket)throw new Error('Invalid key shard');load(shard.entries,bucket);}finally{bytes.fill(0);}
            }
          }else throw new Error('Unsupported vault version');
        }finally{plain.fill(0);}
      }
      this.expire();
      const live=new Set([...this.entries.values(),...this.shards.values()].map(e=>e.blob+".enc"));
      for(const file of readdirSync(this.directory))if(/^[a-f0-9]{64}\.enc$/.test(file)&&!live.has(file)&&!this.pinnedBlobs.has(file.slice(0,-4))){try{unlinkSync(join(this.directory,file));}catch{/* No indexed key remains for the orphan. */}}
    } catch(error) {this.lock();throw error;}
  }
  lock():void {this.master?.fill(0);this.master=null;for(const entry of [...this.entries.values(),...this.shards.values()])entry.key.fill(0);this.entries.clear();this.shards.clear();this.dirty.clear();this.buckets.clear();}
  private requireKey():Buffer {if(!this.master) throw new Error('Vault locked');return this.master;}
  private path(blob:string):string {return join(this.directory,blob+'.enc');}
  private persist():void {
    this.requireKey();if(!this.dirty.size&&existsSync(join(this.directory,'index.enc')))return;
    const previous=this.shards,proposed=new Map(previous),created:Shard[]=[];
    try{
      const groups=new Map<number,Record<string,SavedEntry>>();for(const bucket of this.dirty)groups.set(bucket,{});
      for(const [id,e] of this.entries){const group=groups.get(this.bucket(id));if(group)group[id]={...e,key:e.key.toString('base64')};}
      for(const [bucket,entries] of groups){
        if(!Object.keys(entries).length){proposed.delete(bucket);continue;}
        const shard={key:randomBytes(32),blob:randomBytes(32).toString('hex')};created.push(shard);
        const bytes=Buffer.from(JSON.stringify({version:1,bucket,entries}));
        try{atomic(this.path(shard.blob),seal(shard.key,bytes,'key-shard:'+bucket));}finally{bytes.fill(0);}
        proposed.set(bucket,shard);
      }
      const shards=Object.fromEntries([...proposed].map(([bucket,s])=>[bucket,{blob:s.blob,key:s.key.toString('base64')}]));
      const plain=Buffer.from(JSON.stringify({version:2,shards}));
      try{
        try{atomic(join(this.directory,'index.enc'),rootSeal(this.requireKey(),plain));}
        catch(error){if(error instanceof VaultWriteError&&error.committed){this.shards=proposed;this.dirty.clear();this.lock();for(const old of previous.values())old.key.fill(0);throw new VaultWriteError(true);}throw error;}
      }finally{plain.fill(0);}
      this.shards=proposed;this.dirty.clear();
    }catch(error){
      if(!(error instanceof VaultWriteError&&error.committed&&!this.master))for(const shard of created){shard.key.fill(0);try{unlinkSync(this.path(shard.blob));}catch{}}
      throw error;
    }
    for(const [bucket,old] of previous)if(proposed.get(bucket)!==old){old.key.fill(0);try{unlinkSync(this.path(old.blob));}catch{/* Retry orphan cleanup at unlock. */}}
  }
  put(id:string,plaintext:Buffer,options:{expiresAt?:number;backup?:boolean}={}):void {
    this.requireKey();if(!id || id.length>2048 || plaintext.length>64*1024*1024) throw new Error('Vault record limit');
    const expiresAt=options.expiresAt??null;
    if(expiresAt!==null && (!Number.isSafeInteger(expiresAt) || expiresAt<=Date.now())) throw new Error('Invalid expiration');
    const previous=this.entries.get(id);
    const key=randomBytes(32),blob=randomBytes(32).toString('hex');
    try{atomic(this.path(blob),seal(key,plaintext,id));}catch(error){key.fill(0);throw error;}
    this.entries.set(id,{key,blob,expiresAt,backup:options.backup===true && expiresAt===null && !id.startsWith('protocol:')&&!id.startsWith('protocol-expiry:')});
    this.dirty.add(this.bucket(id));
    if(this.batchEntries){this.batchEntries.push(this.entries.get(id)!);return;}
    try {this.persist();}
    catch(error) {if(this.master){if(previous)this.entries.set(id,previous);else this.entries.delete(id);try{unlinkSync(this.path(blob));}catch{}}else previous?.key.fill(0);key.fill(0);throw error;}
    if(previous){previous.key.fill(0);try{if(!this.pinnedBlobs.has(previous.blob))unlinkSync(this.path(previous.blob));}catch{/* Indexed keys are already discarded; retry orphan cleanup at unlock. */}}
  }

  recordIds(prefix:string):string[]{this.requireKey();return [...this.entries.keys()].filter(id=>id.startsWith(prefix));}
  has(id:string):boolean {this.requireKey();const entry=this.entries.get(id);return !!entry && (entry.expiresAt===null||entry.expiresAt>Date.now());}
  get(id:string):Buffer|null {
    this.requireKey();const entry=this.entries.get(id);if(!entry) return null;
    if(entry.expiresAt!==null && entry.expiresAt<=Date.now()){this.delete(id);return null;}
    return open(entry.key,readFileSync(this.path(entry.blob)),id);
  }
  delete(id:string):void {
    this.requireKey();const entry=this.entries.get(id);if(!entry) return;
    this.entries.delete(id);this.dirty.add(this.bucket(id));
    if(this.batchEntries)return;
    try {this.persist();} catch(error){if(this.master)this.entries.set(id,entry);else entry.key.fill(0);throw error;}
    entry.key.fill(0);
    try{if(!this.pinnedBlobs.has(entry.blob))unlinkSync(this.path(entry.blob));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;}
  }
  transaction(work:()=>void):void {
    this.requireKey();if(this.batchEntries)throw new Error('Nested vault transaction');
    const original=new Map(this.entries),created:Entry[]=[];this.batchEntries=created;let committed=false;
    try{work();this.persist();committed=true;}
    finally{
      this.batchEntries=null;
      if(!committed&&this.master)this.entries=original;
      const retained=new Set(this.entries.values());
      for(const entry of [...original.values(),...created])if(!retained.has(entry)){entry.key.fill(0);if(this.master)try{if(!this.pinnedBlobs.has(entry.blob))unlinkSync(this.path(entry.blob));}catch{/* Orphan cleanup retries after unlock. */}}
    }
  }
  expire(time=Date.now()):void {this.requireKey();const expired=[...this.entries].filter(([,e])=>e.expiresAt!==null&&e.expiresAt<=time).map(([id])=>id);if(!expired.length)return;const remove=()=>{for(const id of expired)this.delete(id);};if(this.batchEntries)remove();else this.transaction(remove);}
  pinPermanent():{records:{id:string;key:Buffer;path:string}[];release:()=>void}{
    this.requireKey();this.expire();const records:{id:string;key:Buffer;path:string;blob:string}[]=[];
    for(const [id,entry] of this.entries)if(entry.backup&&entry.expiresAt===null&&!id.startsWith('protocol:')&&!id.startsWith('protocol-expiry:')){
      records.push({id,key:Buffer.from(entry.key),path:this.path(entry.blob),blob:entry.blob});this.pinnedBlobs.set(entry.blob,(this.pinnedBlobs.get(entry.blob)??0)+1);
    }
    let released=false;return {records,release:()=>{if(released)return;released=true;const live=new Set([...this.entries.values()].map(e=>e.blob));for(const record of records){record.key.fill(0);const n=(this.pinnedBlobs.get(record.blob)??0)-1;if(n>0)this.pinnedBlobs.set(record.blob,n);else{this.pinnedBlobs.delete(record.blob);if(this.master&&!live.has(record.blob))try{unlinkSync(this.path(record.blob));}catch{}}}}};
  }
  restorePermanentRecord(id:string,bytes:Buffer):void {
    if(!id||id.length>2048||/^(protocol|protocol-expiry|device|session|creation|packages|cursor|refresh|cancel-result|restore-authorization):/.test(id)||bytes.length>64*1024*1024)throw new Error('Invalid permanent record');
    if(id.startsWith('tombstone:')){if(!this.entries.has(id))this.put(id,bytes,{backup:true});this.delete(id.slice('tombstone:'.length));return;}
    if(this.entries.has('tombstone:'+id))return;
    if(this.entries.has(id)&&!id.startsWith('recovery:')){
      if((id.startsWith('messages:')||id.startsWith('legacy:'))&&!id.includes(':entry:')){
        const current=this.get(id);try{const old=JSON.parse(bytes.toString()),now=JSON.parse(current!.toString());if(!Array.isArray(old)||!Array.isArray(now)||[...old,...now].some(v=>typeof v!=='string'))throw new Error('Invalid history index');
          const merged=Buffer.from(JSON.stringify([...new Set([...old,...now])].filter(key=>!this.entries.has('tombstone:'+id+':entry:'+key))));try{this.put(id,merged,{backup:true});}finally{merged.fill(0);}
        }finally{current?.fill(0);}
      }
      return;
    }
    this.put(id,bytes,{backup:true});
  }
  exportPermanent(recoveryKey:Buffer):Buffer {
    this.requireKey();this.expire();
    if(recoveryKey.length!==32) throw new Error('Recovery key must have 256 bits');
    const records:Record<string,string>={};let bytesUsed=0;
    for(const [id,e] of this.entries) if(e.backup && e.expiresAt===null && !id.startsWith('protocol:')&&!id.startsWith('protocol-expiry:')) {
      const plain=this.get(id)!;try{bytesUsed+=plain.length;if(bytesUsed>40*1024*1024)throw new Error(translate("common.b3a9faea1112"));records[id]=plain.toString('base64');}finally{plain.fill(0);}
    }
    const plain=Buffer.from(JSON.stringify({version:1,records}));
    try{return seal(recoveryKey,plain,'backup');}finally{plain.fill(0);}
  }
  importPermanent(ciphertext:Buffer,recoveryKey:Buffer):void {
    if(ciphertext.length>64*1024*1024)throw new Error('Backup size limit');
    const plain=open(recoveryKey,ciphertext,'backup');
    try {
      const data=JSON.parse(plain.toString('utf8')) as {version:number;records:Record<string,string>};
      if(data.version!==1||!data.records||Array.isArray(data.records)||Object.keys(data.records).length>100000)throw new Error('Invalid backup');
      const records=Object.entries(data.records);
      for(const [id,value] of records)if(!id||id.length>2048||/^(protocol|protocol-expiry|device|session|creation|packages|cursor|refresh|cancel-result):/.test(id)||typeof value!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('Protocol state or invalid record cannot be restored from exported backups');
      this.transaction(()=>{
        records.sort((a,b)=>Number(b[0].startsWith('tombstone:'))-Number(a[0].startsWith('tombstone:')));
        for(const [id,value] of records){const bytes=Buffer.from(value,'base64');try{this.restorePermanentRecord(id,bytes);}finally{bytes.fill(0);}}

      });
    } finally {plain.fill(0);}
  }
}
