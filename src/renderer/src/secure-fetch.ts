import {secureHttpUrl} from '../../shared/transport.ts';
/** Every renderer request: HTTPS (or loopback) only, and no redirects. */
export async function secureFetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response>{
 secureHttpUrl(new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url,location.href));
 return fetch(input,{...init,redirect:'error'});
}
