import {createHash,createPrivateKey,randomUUID} from 'node:crypto';
import {SignJWT} from 'jose';
/** Server clock minus this device's clock, per origin: a wrong PC clock must not break device proofs. */
const skew=new Map<string,number>();
export function observeServerClock(url:string,response:Response):void{
 const date=Date.parse(response.headers.get('date')??'');if(!Number.isFinite(date))return;
 const offset=date+500-Date.now();
 try{const origin=new URL(url).origin;if(Math.abs(offset)>2000)skew.set(origin,offset);else skew.delete(origin);}catch{}
}
export async function deviceProof(publicKey:string,privateKey:string,token:string,method:string,uri:string,nonce:string):Promise<string>{
 const target=new URL(uri);target.search='';target.hash='';
 const key=createPrivateKey({key:Buffer.from(privateKey,'base64'),format:'der',type:'pkcs8'});
 return new SignJWT({htm:method.toUpperCase(),htu:target.toString(),ath:createHash('sha256').update(token).digest('base64url'),nonce})
  .setProtectedHeader({typ:'dpop+jwt',alg:'EdDSA',jwk:{kty:'OKP',crv:'Ed25519',x:publicKey}}).setIssuedAt(Math.floor((Date.now()+(skew.get(target.origin)??0))/1000)).setJti(randomUUID()).sign(key);
}
