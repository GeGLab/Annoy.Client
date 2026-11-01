import {secureFetch} from "./secure-fetch.ts";
import type { ApiError, AuthResponse, DiscordLoginBegin, DiscordLoginPoll, InstanceInfo } from "@distopic/protocol";

export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const DEFAULT_PORT = 8787;

/**
 * Addresses to try for what the user typed: a full URL is used as is. A bare
 * name ("chat.example.com") is tried over HTTPS first, as behind a proxy or
 * tunnel, then on the default Annoy port, TeamSpeak style ("192.168.0.10").
 */
export function candidateUrls(input: string): string[] {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return [new URL(trimmed).origin];
  const bare = new URL(`http://${trimmed}`);
  const secure = new URL(`https://${trimmed}`).origin;
  if (bare.port) return [bare.origin, secure];
  bare.port = String(DEFAULT_PORT);
  return [secure, bare.origin];
}

/** Finds the Annoy server behind what the user typed, trying each candidate address in turn. */
export async function findInstance(input: string): Promise<{ url: string; info: InstanceInfo }> {
  const urls = candidateUrls(input);
  let lastError: unknown;
  for (const url of urls) {
    try {
      // A host that drops HTTPS silently must not stall the fallback.
      const res = await secureFetch(`${url}/api/info`, { signal: AbortSignal.timeout(urls.length > 1 ? 5000 : 15000) });
      const info = await parse<InstanceInfo>(res);
      if (typeof info?.name === "string") return { url, info };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof RequestError ? lastError : new TypeError("unreachable");
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : {};
  if (!res.ok) throw new RequestError(res.status, (body as Partial<ApiError>).message ?? `HTTP ${res.status}`);
  return body as T;
}

export async function fetchInfo(url: string): Promise<InstanceInfo> {
  return parse(await secureFetch(`${url}/api/info`));
}

export async function authenticate(
  url: string,
  mode: "login" | "register",
  body: { username: string; password: string; displayName?: string; inviteCode?: string },
): Promise<AuthResponse> {
  return parse(
    await secureFetch(`${url}/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 10 * 60_000;

/**
 * Runs "Entrar com Discord": opens Discord's authorize page in the system
 * browser and polls the Annoy server until the browser leg finishes.
 * `begin` is the (optionally authenticated) call that starts the login.
 */
export async function discordLogin(url: string, begin: () => Promise<DiscordLoginBegin>, signal: AbortSignal): Promise<Extract<DiscordLoginPoll, { status: "done" }>> {
  const { url: authorizeUrl, handoff } = await begin();
  window.open(authorizeUrl, "_blank");
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (signal.aborted) throw new Error("Cancelado");
    const result = await parse<DiscordLoginPoll>(
      await secureFetch(`${url}/api/auth/discord/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handoff }),
        signal,
      }),
    );
    if (result.status === "done") return result;
    if (result.status === "error") throw new Error(result.message);
  }
  throw new Error("Tempo esgotado esperando o Discord");
}

export async function beginDiscordLogin(url: string, inviteCode?: string): Promise<DiscordLoginBegin> {
  return parse(
    await secureFetch(`${url}/api/auth/discord/begin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inviteCode ? { inviteCode } : {}),
    }),
  );
}

export class Api {
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
    private readonly canWrite: () => boolean = () => true,
    private readonly userId:string="",
  ) {}

  private async nativeCrypto(){
    if(!window.distopic?.crypto||!this.userId)throw new Error('Identidade local e serviço criptográfico são necessários');
    await window.distopic.crypto.guard(this.baseUrl,this.token,'identity',this.userId);return window.distopic.crypto;
  }
  private requireConnection(): void {
    if (!this.canWrite()) throw new Error("Sem conexão com o servidor. Aguarde a reconexão para continuar.");
  }

  async request<T = unknown>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    if (method !== "GET" && method !== "HEAD") this.requireConnection();
    if(method==='POST'&&/^\/channels\/[^/]+\/messages(?:\?|$)/.test(path))throw new Error('Novas mensagens exigem o serviço MLS; envio direto em texto claro bloqueado.');
    if(method==='GET'&&path.startsWith('/search/messages?')){
      if(!window.distopic?.crypto)throw new Error('Busca local exige o serviço criptográfico');
      return await (await this.nativeCrypto()).search(this.baseUrl,this.token,Object.fromEntries(new URLSearchParams(path.split('?')[1]))) as T;
    }
    const mutation=/^\/channels\/([^/]+)\/messages\/([^/]+)(?:\/reactions\/([^/?]+))?$/.exec(path);
    if(mutation&&['PATCH','DELETE','PUT'].includes(method)){
      const channel=decodeURIComponent(mutation[1]!);
      const marker={url:this.baseUrl,channel,id:decodeURIComponent(mutation[2]!),captured:false,previous:undefined as unknown};
      window.dispatchEvent(new CustomEvent('annoy:crypto-begin',{detail:marker}));
      const pinned=this.userId&&window.distopic?.crypto?await window.distopic.crypto.guard(this.baseUrl,this.token,channel,this.userId):false;
      const response=await secureFetch(`${this.baseUrl}/api/channels/${encodeURIComponent(channel)}/crypto`,{headers:{authorization:`Bearer ${this.token}`}});
      if(!response.ok&&pinned)throw new Error('Canal E2EE indisponível');
      if(pinned||(response.ok&&(await response.json() as {channel:unknown}).channel)){
        if(!window.distopic?.crypto)throw new Error('Serviço criptográfico indisponível');
        const kind=mutation[3]?'reaction':method==='PATCH'?'edit':'delete';
        const result=await window.distopic.crypto.action(this.baseUrl,this.token,channel,kind,decodeURIComponent(mutation[2]!),mutation[3]?decodeURIComponent(mutation[3]):(body as {content?:string}|undefined)?.content??'',method!=='DELETE');
        window.dispatchEvent(new CustomEvent('annoy:crypto-change',{detail:{...marker,message:result}}));
        return result as T;
      }
      // Never send a new edit or reaction in plaintext, even when there is no
      // active group yet. Only deletion of the explicitly legacy source may
      // use its existing administrative endpoint.
      if(method==='PATCH'||mutation[3])throw new Error('Histórico legado é somente leitura para edições e reações. Use uma conversa MLS para novo conteúdo.');
    }
    const messagePath = /^\/channels\/([^/]+)\/messages(?:\?(.*))?$/.exec(path);
    if (method === "GET" && messagePath) {
      const channel = decodeURIComponent(messagePath[1]!);
      const response = await secureFetch(`${this.baseUrl}/api/channels/${encodeURIComponent(channel)}/crypto`, { headers: { authorization: `Bearer ${this.token}` } });
      const pinned=window.distopic?.crypto&&this.userId?await window.distopic.crypto.guard(this.baseUrl,this.token,channel,this.userId):false;
      if(!response.ok&&pinned)throw new Error("Tentativa de downgrade: o canal já utilizava E2EE");
      if (response.ok) {
        const status = await response.json() as { channel: unknown };
        if(!status.channel&&pinned)throw new Error("Tentativa de downgrade: o canal já utilizava E2EE");
        if (status.channel) {
          if (!window.distopic?.crypto) throw new Error("Abra o cliente desktop para ler mensagens E2EE");
          const query=new URLSearchParams(messagePath[2]??"");const before=query.get("before");
          return await window.distopic.crypto.sync(this.baseUrl,this.token,channel,before??undefined) as T;
        }
      }
    }
    const res = await secureFetch(`${this.baseUrl}/api${path}`, {
      signal,
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return parse<T>(res);
  }

  get = <T>(path: string) => this.request<T>("GET", path);
  post = <T>(path: string, body: unknown = {}) => this.request<T>("POST", path, body);
  patch = <T>(path: string, body: unknown) => this.request<T>("PATCH", path, body);
  put = <T>(path: string, body: unknown = {}) => this.request<T>("PUT", path, body);
  del = <T>(path: string) => this.request<T>("DELETE", path);

  async uploadServerIcon<T>(serverId: string, photo: Blob): Promise<T> {
    this.requireConnection();
    const body = new FormData(); body.append("icon", photo, "icon");
    return parse<T>(await secureFetch(`${this.baseUrl}/api/servers/${serverId}/icon`, { method: "POST", headers: { authorization: `Bearer ${this.token}` }, body, signal: AbortSignal.timeout(20_000) }));
  }

  async uploadAvatar<T>(photo: Blob): Promise<T> {
    this.requireConnection();
    const body = new FormData(); body.append("avatar", photo, "avatar.webp");
    return parse<T>(await secureFetch(`${this.baseUrl}/api/users/@me/avatar`, { method: "POST", headers: { authorization: `Bearer ${this.token}` }, body, signal: AbortSignal.timeout(20_000) }));
  }

  async sendMessage<T>(channelId: string, content: string, files: File[], replyToId: string | null, expiresAt:string|null=null,signal?:AbortSignal): Promise<T> {
    this.requireConnection();
    if (!window.distopic?.crypto) throw new Error("O envio exige o serviço criptográfico do cliente desktop");
    const encryptedFiles=await Promise.all(files.map(async file=>({name:file.name,type:file.type,bytes:await file.arrayBuffer()})));
    const id=crypto.randomUUID(),cancel=()=>{void window.distopic!.crypto.cancel(id).catch(()=>{});};
    try{
      signal?.throwIfAborted();signal?.addEventListener('abort',cancel,{once:true});
      const sending=(await this.nativeCrypto()).send(this.baseUrl,this.token,channelId,content,replyToId,encryptedFiles,expiresAt,id);
      if(signal?.aborted)cancel();
      const message=await sending;
      window.dispatchEvent(new CustomEvent("annoy:crypto-message",{detail:{url:this.baseUrl,message}}));return message as T;
    }finally{signal?.removeEventListener('abort',cancel);for(const file of encryptedFiles)new Uint8Array(file.bytes).fill(0);}
  }
  async attachment(channel:string,messageId:string,id:string){return (await this.nativeCrypto()).attachment(this.baseUrl,this.token,channel,messageId,id);}
  downloadLegacy(file:import('@distopic/protocol').Attachment){if(!window.distopic)throw new Error('Abra o cliente desktop');return window.distopic.downloadPrivate(this.baseUrl,this.token,file.url,file.filename);}
  async legacyAttachment(file:import('@distopic/protocol').Attachment):Promise<{bytes:ArrayBuffer;type:string;name:string}>{
    const url=new URL(file.url,this.baseUrl);
    if(url.origin!==new URL(this.baseUrl).origin||!/^\/api\/uploads\/[a-f0-9]{32}\//.test(url.pathname))throw new Error('Endereço de anexo inválido');
    if(file.size>64*1024*1024)throw new Error('Prévia limitada a 64 MiB; use o download autenticado para arquivos maiores');
    const response=await secureFetch(url.toString(),{headers:{authorization:`Bearer ${this.token}`},cache:'no-store',redirect:'error'});
    if(!response.ok||!response.body)throw new Error('Anexo legado indisponível');
    let size=0;const chunks:Uint8Array[]=[];
    for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>64*1024*1024)throw new Error('Limite de prévia atingido');chunks.push(chunk);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;chunk.fill(0);}
    return {bytes:bytes.buffer,type:file.contentType,name:file.filename};
  }
  async cryptoStatus(channel:string) {return (await this.nativeCrypto()).status(this.baseUrl,this.token,channel);}
  async cryptoCode(channel:string,userId:string) {return (await this.nativeCrypto()).code(this.baseUrl,this.token,channel,userId);}
  async verifyCryptoCode(channel:string,userId:string,code:string) {return (await this.nativeCrypto()).verify(this.baseUrl,this.token,channel,userId,code);}
  async legacyMessages<T>(channel:string,before?:string):Promise<T>{return parse(await secureFetch(`${this.baseUrl}/api/channels/${encodeURIComponent(channel)}/legacy/messages?limit=50${before?'&before='+encodeURIComponent(before):''}`,{headers:{authorization:`Bearer ${this.token}`}}));}

  /** Like sendMessage with files, reporting upload progress from 0 to 1. */
  uploadMessage<T>(channelId: string, content: string, files: File[], onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
    if (!this.canWrite()) return Promise.reject(new Error("Sem conexão com o servidor. Aguarde a reconexão para continuar."));
    if(signal?.aborted)return Promise.reject(new DOMException("Envio cancelado","AbortError"));
    onProgress(0);
    return this.sendMessage<T>(channelId,content,files,null,null,signal).then(message=>{onProgress(1);return message;});
  }

  /** Attachment URLs are server-relative. */
  resolve(path: string): string {
    return path.startsWith("http") ? path : `${this.baseUrl}${path}`;
  }
}
