/** Authenticated remote traffic always uses TLS. The sole HTTP exception is
 * explicit loopback development; redirects must not weaken this decision. */
export function secureHttpUrl(value:string|URL):URL {
 let url:URL;try{url=new URL(value);}catch{throw new Error('Endereço de servidor inválido');}
 if(url.username||url.password)throw new Error('Não inclua credenciais no endereço do servidor');
 if(url.protocol==='https:')return url;
 if(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))return url;
 throw new Error('Conexões remotas exigem HTTPS e WSS; HTTP só é permitido no loopback local.');
}
