import * as Popover from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import { Smile, Search, Download, Trash2, Upload, Store, ImagePlus, X } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { toast } from "../../store.ts";
import { confirmAction } from "../../components/ui/action-dialog.tsx";
import { CATALOG, EMOJIS, exportPack, installPack, parsePack, readPacks, removePack, savePack, type MediaItem, type MediaKind, type MediaPack } from "./library.ts";
import { giphyImage, giphyKey, localGiphyKey, searchGiphy, setGiphyKey, type GiphyItem } from "./giphy.tsx";

function ItemImage({ item }: { item: MediaItem }) {
  const [url,setUrl] = useState(item.url);
  useEffect(() => { if (!item.blob) { setUrl(item.url); return; } const url=URL.createObjectURL(item.blob); setUrl(url); return () => URL.revokeObjectURL(url); }, [item.blob,item.url]);
  return item.emoji ? <span>{item.emoji}</span> : <img src={url} alt="" loading="lazy" />;
}
const matches = (item: MediaItem, query: string) => `${item.name} ${item.emoji ?? ""}`.normalize("NFD").replace(/\p{M}/gu,"").toLocaleLowerCase("pt-BR").includes(query.normalize("NFD").replace(/\p{M}/gu,"").toLocaleLowerCase("pt-BR"));
export function EmojiMenu({ onSelect, disabled=false }: { onSelect: (emoji: string) => void; disabled?: boolean }) {
  const [open,setOpen]=useState(false), [query,setQuery]=useState("");
  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger asChild><button className="icon-btn tiny" aria-label="Adicionar reação" title="Adicionar reação" disabled={disabled}><Smile size={16} /></button></Popover.Trigger><Popover.Portal><Popover.Content side="top" align="end" collisionPadding={12} sideOffset={8} className="expression-picker reaction-picker" role="dialog" aria-label="Escolher reação"><Input aria-label="Buscar emoji para reação" placeholder="Buscar emoji" value={query} onChange={(event)=>setQuery(event.target.value)} /><div className="expression-grid emoji-grid">{EMOJIS.filter((item)=>matches(item,query)).map((item)=><button key={item.id} title={item.name} aria-label={item.name} onClick={()=>{onSelect(item.emoji!);setOpen(false);}}>{item.emoji}</button>)}</div><Popover.Arrow className="popover-arrow" /></Popover.Content></Popover.Portal></Popover.Root>;
}

export function MediaPicker({accountId,canAttach,onEmoji,onFile,onLink,disabled=false}:{accountId:string;canAttach:boolean;onEmoji:(emoji:string)=>void;onFile:(file:File)=>void;onLink:(link:string)=>void;disabled?:boolean}) {
  const [open,setOpen]=useState(false), [tab,setTab]=useState<MediaKind|"store">("emoji"), [query,setQuery]=useState("");
  const [packs,setPacks]=useState<MediaPack[]>([]), [busy,setBusy]=useState(false), [error,setError]=useState<string|null>(null);
  const [provider,setProvider]=useState<"local"|"giphy">("local"), [key,setKey]=useState<string|null>(null), [draftKey,setDraftKey]=useState(localGiphyKey);
  const [results,setResults]=useState<GiphyItem[]>([]), [loading,setLoading]=useState(false), [offset,setOffset]=useState(0), [more,setMore]=useState(false);
  const input=useRef<HTMLInputElement>(null), manifest=useRef<HTMLInputElement>(null);
  const reload=async()=>setPacks(await readPacks());
  useEffect(()=>{if(open){void reload().catch((error)=>setError(error.message));void giphyKey(accountId).then(setKey);}},[open,accountId]);
  useEffect(()=>{
    if (!open || tab!=="gif" || provider!=="giphy" || !key) return;
    const controller=new AbortController(); setLoading(true);setError(null);
    const timer=setTimeout(()=>void searchGiphy(key,query,controller.signal,offset).then((response)=>{setResults(response.data);setMore(response.pagination.offset+response.pagination.count<response.pagination.total_count);}).catch((error)=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);}),300);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[open,tab,provider,key,query,offset]);
  const perform=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setError(null);try{await action();await reload();}catch(error){setError((error as Error).message);}finally{setBusy(false);}};
  const select=(item:MediaItem)=>{if(item.emoji)onEmoji(item.emoji);else if(canAttach&&item.blob)onFile(new File([item.blob],`${item.name.replace(/[^\p{L}\p{N}_ -]/gu,"") || "figurinha"}.${item.blob.type.split("/")[1]}`,{type:item.blob.type}));else return;setOpen(false);};
  const importFiles=async(files:File[])=>{
    if(files.length>60)throw new Error("Importe até 60 imagens por vez.");
    const current=packs.find((pack)=>pack.id==="my-media");
    const items=[...(current?.items??[])];
    for(const file of files){if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>8*1024*1024)throw new Error("Use PNG, JPEG, WebP ou GIF de até 8 MB.");items.push({id:crypto.randomUUID(),name:file.name.slice(0,80),kind:file.type==="image/gif"?"gif":"sticker",blob:file});}
    if(items.length>60)throw new Error("Sua coleção pode ter até 60 imagens. Remova um pacote ou importe outro manifesto.");
    if(items.reduce((sum,item)=>sum+(item.blob?.size??0),0)>50*1024*1024)throw new Error("Sua coleção pode ter até 50 MB.");
    await savePack({id:"my-media",name:"Minha coleção",author:"Você",license:"Conteúdo fornecido pelo usuário",source:"local",items});
  };
  const shown=(tab==="emoji"?[{id:"unicode",name:"Emojis",items:EMOJIS},...packs]:packs).map((pack)=>({...pack,items:pack.items.filter((item)=>item.kind===tab&&matches(item,query))})).filter((pack)=>pack.items.length);
  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger asChild><button className="icon-btn" aria-label="Emojis, GIFs e figurinhas" title="Emojis, GIFs e figurinhas" disabled={disabled}><Smile size={21}/></button></Popover.Trigger><Popover.Portal><Popover.Content className="expression-picker" side="top" align="end" sideOffset={12} collisionPadding={12} role="dialog" aria-label="Emojis, GIFs e figurinhas">
    <header><div className="expression-tabs" role="tablist" aria-label="Tipo de mídia">{([['emoji','Emojis'],['gif','GIFs'],['sticker','Figurinhas'],['store','Loja']] as const).map(([id,label])=><button role="tab" aria-selected={tab===id} key={id} onClick={()=>{setTab(id);setQuery("");setError(null);setOffset(0);}}>{id==="store"&&<Store size={14}/>} {label}</button>)}</div><Popover.Close className="icon-btn tiny" aria-label="Fechar seletor"><X size={16}/></Popover.Close></header>
    {tab!=="store"&&<div className="expression-search"><Search size={15}/><Input aria-label="Buscar na biblioteca de mídia" placeholder={tab==="emoji"?"Buscar emoji":tab==="gif"?"Buscar GIF":"Buscar figurinha"} value={query} onChange={(event)=>{setQuery(event.target.value);setOffset(0);}}/></div>}
    {tab==="gif"&&<div className="expression-sources"><button aria-pressed={provider==="local"} onClick={()=>setProvider("local")}>Minha biblioteca</button><button aria-pressed={provider==="giphy"} onClick={()=>setProvider("giphy")}>GIPHY</button></div>}
    {error&&<p className="expression-error" role="alert">{error}</p>}
    <div className="expression-scroll" role="tabpanel" aria-label={tab==="store"?"Loja de pacotes":tab==="emoji"?"Emojis":tab==="gif"?"GIFs":"Figurinhas"}>
      {tab==="store"?<><div className="expression-store-intro"><h3>Sua coleção, do seu jeito</h3><p>Instale pacotes, importe suas imagens e compartilhe coleções. Os downloads ficam neste dispositivo.</p></div>
        {CATALOG.map((pack)=><article className="expression-pack" key={pack.id}><div className="expression-pack-preview">{pack.items.slice(0,3).map((item)=><ItemImage key={item.id} item={item}/>)}</div><div><strong>{pack.name}</strong><small>{pack.items.length} itens · {pack.author}</small><small>{pack.license} · <a href={pack.source} target="_blank" rel="noreferrer">Origem</a></small></div><Button variant="secondary" size="sm" disabled={busy||packs.some((saved)=>saved.id===pack.id)} onClick={()=>void perform(()=>installPack(pack))}><Download size={14}/>{packs.some((saved)=>saved.id===pack.id)?"Instalado":"Baixar"}</Button></article>)}
        <div className="expression-import-actions"><Button variant="secondary" size="sm" disabled={busy} onClick={()=>input.current?.click()}><ImagePlus size={15}/>Importar imagens</Button><Button variant="secondary" size="sm" disabled={busy} onClick={()=>manifest.current?.click()}><Upload size={15}/>Importar pacote</Button></div>
        {packs.length>0&&<section className="expression-installed"><h3>Pacotes instalados</h3>{packs.map((pack)=><div key={pack.id}><span><strong>{pack.name}</strong><small>{pack.items.length} itens · {pack.author} · {pack.license}</small></span><button className="icon-btn tiny" aria-label={`Exportar ${pack.name}`} disabled={busy} onClick={()=>void perform(async()=>{const blob=await exportPack(pack),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`${pack.name}.annoy-pack.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})}><Download size={15}/></button><button className="icon-btn tiny danger" aria-label={`Remover ${pack.name}`} disabled={busy} onClick={()=>void confirmAction(`Remover o pacote ${pack.name} deste dispositivo?`).then((yes)=>{if(yes)return perform(()=>removePack(pack.id));})}><Trash2 size={15}/></button></div>)}</section>}
        <section className="expression-provider-config"><h3>Busca online de GIFs</h3><p>Use a chave pública de cliente do GIPHY. A instância também pode fornecer uma chave.</p><Input aria-label="Chave de cliente GIPHY" value={draftKey} onChange={(event)=>setDraftKey(event.target.value)} placeholder="Chave da API GIPHY"/><Button variant="secondary" size="sm" onClick={()=>{setGiphyKey(draftKey);void giphyKey(accountId).then(setKey);toast("Configuração do GIPHY salva neste dispositivo.");}}>Salvar chave</Button></section>
        <input ref={input} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Importar imagens da biblioteca" onChange={(event)=>{const files=Array.from(event.target.files??[]);event.target.value="";if(files.length)void perform(()=>importFiles(files));}}/>
        <input ref={manifest} type="file" hidden accept="application/json,.json" aria-label="Importar pacote da biblioteca" onChange={(event)=>{const file=event.target.files?.[0];event.target.value="";if(file)void perform(async()=>{if(file.size>72*1024*1024)throw new Error("Pacote muito grande.");await installPack(parsePack(JSON.parse(await file.text())));});}}/>
      </>:tab==="gif"&&provider==="giphy"?<>{!key?<div className="expression-empty"><h3>Conecte o GIPHY</h3><p>Configure uma chave de cliente na aba Loja ou peça ao administrador da instância para habilitar a busca. Você também pode importar seus próprios GIFs.</p><Button variant="secondary" size="sm" onClick={()=>setTab("store")}>Configurar biblioteca</Button></div>:<>{loading?<p role="status">Buscando GIFs…</p>:<><div className="expression-grid gif-grid">{results.map((item)=><button key={item.id} aria-label={item.title||"Selecionar GIF"} onClick={()=>{onLink(`https://giphy.com/gifs/${item.id}`);setOpen(false);}}><img src={giphyImage(item.images.fixed_height.url)} alt={item.title||"GIF"} loading="lazy"/></button>)}</div>{!results.length&&<p className="expression-empty">Nenhum GIF encontrado.</p>}<div className="expression-pagination"><Button variant="ghost" size="sm" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-24))}>Anterior</Button><Button variant="ghost" size="sm" disabled={!more} onClick={()=>setOffset(offset+24)}>Próximos</Button></div></>}</>}</>
      :shown.length?shown.map((pack)=><section className="expression-group" key={pack.id}><h3>{pack.name}</h3><div className={`expression-grid ${tab==="emoji"?"emoji-grid":"sticker-grid"}`}>{pack.items.map((item)=><button disabled={item.kind!=="emoji"&&!canAttach} key={item.id} title={item.name} aria-label={item.name} onClick={()=>select(item)}><ItemImage item={item}/></button>)}</div></section>):<div className="expression-empty"><h3>{query?"Nenhum resultado":"Sua biblioteca começa aqui"}</h3><p>{query?"Tente outro termo de busca.":"Instale um pacote na Loja ou importe suas imagens e GIFs."}</p><Button variant="secondary" size="sm" onClick={()=>setTab("store")}>Abrir loja</Button></div>}
    </div><footer>{busy?<span role="status">Salvando pacote…</span>:tab==="gif"&&provider==="giphy"?<a href="https://giphy.com" target="_blank" rel="noreferrer">Powered by GIPHY</a>:<span>{tab==="emoji"?"Escolha um emoji para inserir na mensagem.":tab==="store"?"Pacotes JSON com nome, autor, licença e itens.":"Escolha uma imagem e envie pelo compositor."}</span>}</footer>
  </Popover.Content></Popover.Portal></Popover.Root>;
}
