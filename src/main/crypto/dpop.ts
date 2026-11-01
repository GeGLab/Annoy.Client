import {createHash,createPrivateKey,randomUUID} from 'node:crypto';
import {SignJWT} from 'jose';
export async function deviceProof(publicKey:string,privateKey:string,token:string,method:string,uri:string,nonce:string):Promise<string>{
 const target=new URL(uri);target.search='';target.hash='';
 const key=createPrivateKey({key:Buffer.from(privateKey,'base64'),format:'der',type:'pkcs8'});
 return new SignJWT({htm:method.toUpperCase(),htu:target.toString(),ath:createHash('sha256').update(token).digest('base64url'),nonce})
  .setProtectedHeader({typ:'dpop+jwt',alg:'EdDSA',jwk:{kty:'OKP',crv:'Ed25519',x:publicKey}}).setIssuedAt().setJti(randomUUID()).sign(key);
}
