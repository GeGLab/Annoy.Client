import {secureHttpUrl} from '../../shared/transport.ts';
/** DPoP signing stays in the trusted process; the renderer never receives device keys. */
export async function secureFetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response>{
 const url=secureHttpUrl(new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url,location.href)),headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
 const method=init?.method??(input instanceof Request?input.method:'GET');
 const token=headers.get('authorization')?.match(/^(?:Bearer|DPoP) (.+)$/)?.[1];
 if(token && url.pathname.startsWith('/api/') && window.distopic?.crypto){
  const proof=await window.distopic.crypto.proof(url.origin,token,method,url.pathname+url.search);
  if(proof){headers.set('authorization','DPoP '+token);headers.set('dpop',proof);}
 }
 let response=await fetch(input,{...init,headers,redirect:'error'});
 const nonce=response.headers.get('dpop-nonce');
 if(response.status===401 && nonce && token && window.distopic?.crypto){
  const proof=await window.distopic.crypto.proof(url.origin,token,method,url.pathname+url.search,nonce);
  if(proof){headers.set('authorization','DPoP '+token);headers.set('dpop',proof);await response.body?.cancel();response=await fetch(input,{...init,headers,redirect:'error'});}
 }
 return response;
}
