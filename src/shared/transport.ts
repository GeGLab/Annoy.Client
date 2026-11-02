import {t as translate} from "./localization/index.ts";
/** Authenticated remote traffic always uses TLS. The sole HTTP exception is
 * explicit loopback development; redirects must not weaken this decision. */
export function secureHttpUrl(value:string|URL):URL {
 let url:URL;try{url=new URL(value);}catch{throw new Error(translate("common.74045a50f9c3"));}
 if(url.username||url.password)throw new Error(translate("common.b70876dbf06f"));
 if(url.protocol==='https:')return url;
 if(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))return url;
 throw new Error(translate("common.740c85198c6d"));
}
