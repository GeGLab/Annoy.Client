import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Download, Trash2, Upload, ImagePlus } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Icon } from "../../components/ui.tsx";
import { setState, toast } from "../../store.ts";
import { requestNavigation } from "../../lib/navigation-guard.ts";
import { confirmAction } from "../../components/ui/action-dialog.tsx";
import { CATALOG, exportPack, installPack, parsePack, readPacks, removePack, savePack, type MediaPack } from "./library.ts";
import { ItemImage } from "./MediaPicker.tsx";
import { localGiphyKey, setGiphyKey } from "./giphy.tsx";
import { hasMediaPicker, openMediaPicker, subscribeMediaPicker } from "./navigation.ts";

export function MediaLibrarySettings() {
  const canUse = useSyncExternalStore(subscribeMediaPicker, hasMediaPicker);
  const [packs,setPacks]=useState<MediaPack[]>([]), [busy,setBusy]=useState(false), [error,setError]=useState<string|null>(null);
  const [draftKey,setDraftKey]=useState(localGiphyKey);
  const input=useRef<HTMLInputElement>(null), manifest=useRef<HTMLInputElement>(null);
  const reload=async()=>setPacks(await readPacks());
  useEffect(()=>{void reload().catch((error)=>setError(error.message));},[]);
  const perform=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setError(null);try{await action();await reload();}catch(error){setError((error as Error).message);}finally{setBusy(false);}};
  const usePack=(pack:MediaPack)=>{
    if(!canUse)return;
    requestNavigation(()=>{
      setState((s)=>{s.modal=null;});
      // Dialogs restore focus on the next frame, including the unsaved-changes guard.
      // Open the picker after that restoration so it keeps keyboard focus.
      requestAnimationFrame(()=>requestAnimationFrame(()=>openMediaPicker(pack.items.some((item)=>item.kind==="sticker")?"sticker":pack.items.some((item)=>item.kind==="gif")?"gif":"emoji")));
    });
  };
  const importFiles=async(files:File[])=>{
    if(files.length>60)throw new Error("Importe até 60 imagens por vez.");
    const current=packs.find((pack)=>pack.id==="my-media");
    const items=[...(current?.items??[])];
    for(const file of files){if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>8*1024*1024)throw new Error("Use PNG, JPEG, WebP ou GIF de até 8 MB.");items.push({id:crypto.randomUUID(),name:file.name.slice(0,80),kind:file.type==="image/gif"?"gif":"sticker",blob:file});}
    if(items.length>60)throw new Error("Sua coleção pode ter até 60 imagens. Remova um pacote ou importe outro manifesto.");
    if(items.reduce((sum,item)=>sum+(item.blob?.size??0),0)>50*1024*1024)throw new Error("Sua coleção pode ter até 50 MB.");
    await savePack({id:"my-media",name:"Minha coleção",author:"Você",license:"Conteúdo fornecido pelo usuário",source:"local",items});
  };
  return <section className="settings-section media-library-settings"><h3><Icon name="image" size={24} />Emojis e mídia</h3><p className="muted">Organize seus emojis, GIFs e figurinhas. Sua coleção fica salva neste dispositivo.</p>{!canUse&&<p className="muted small">Abra uma conversa para usar seus pacotes. Você pode gerenciar a coleção aqui a qualquer momento.</p>}<h4>Adicionar pacotes</h4>
        {CATALOG.map((pack)=><article className="expression-pack" key={pack.id}><div className="expression-pack-preview">{pack.items.slice(0,3).map((item)=><ItemImage key={item.id} item={item}/>)}</div><div><strong>{pack.name}</strong><small>{pack.items.length} itens · {pack.author}</small><small>{pack.license} · <a href={pack.source} target="_blank" rel="noreferrer">Origem</a></small></div><Button variant="secondary" size="sm" disabled={busy || (!canUse && packs.some((saved)=>saved.id===pack.id))} onClick={()=>packs.some((saved)=>saved.id===pack.id)?usePack(pack):void perform(()=>installPack(pack))}><Download size={14}/>{packs.some((saved)=>saved.id===pack.id)?"Usar":"Baixar"}</Button></article>)}
        <div className="expression-import-actions"><Button variant="secondary" size="sm" disabled={busy} onClick={()=>input.current?.click()}><ImagePlus size={15}/>Importar imagens</Button><Button variant="secondary" size="sm" disabled={busy} onClick={()=>manifest.current?.click()}><Upload size={15}/>Importar pacote</Button></div>
        {packs.length>0&&<section className="expression-installed"><h4>Pacotes instalados</h4>{packs.map((pack)=><div key={pack.id}><span><strong>{pack.name}</strong><small>{pack.items.length} itens · {pack.author} · {pack.license}</small></span><Button variant="secondary" size="sm" disabled={busy || !canUse} title={canUse?"Usar na conversa":"Abra uma conversa para usar este pacote"} onClick={()=>usePack(pack)} aria-label={`Usar ${pack.name}`}>Usar</Button><button className="icon-btn tiny" aria-label={`Exportar ${pack.name}`} disabled={busy} onClick={()=>void perform(async()=>{const blob=await exportPack(pack),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`${pack.name}.annoy-pack.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})}><Download size={15}/></button><button className="icon-btn tiny danger" aria-label={`Remover ${pack.name}`} disabled={busy} onClick={()=>void confirmAction(`Remover o pacote ${pack.name} deste dispositivo?`).then((yes)=>{if(yes)return perform(()=>removePack(pack.id));})}><Trash2 size={15}/></button></div>)}</section>}
        <details className="expression-provider-config"><summary>Busca online de GIFs</summary><div className="expression-provider-fields"><p>Use a chave pública de cliente do GIPHY. A instância também pode fornecer uma chave.</p><Input aria-label="Chave de cliente GIPHY" value={draftKey} onChange={(event)=>setDraftKey(event.target.value)} placeholder="Chave da API GIPHY"/><Button variant="secondary" size="sm" onClick={()=>{setGiphyKey(draftKey);toast("Configuração do GIPHY salva neste dispositivo.");}}>Salvar chave</Button></div></details>
        <input ref={input} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Importar imagens da biblioteca" onChange={(event)=>{const files=Array.from(event.target.files??[]);event.target.value="";if(files.length)void perform(()=>importFiles(files));}}/>
        <input ref={manifest} type="file" hidden accept="application/json,.json" aria-label="Importar pacote da biblioteca" onChange={(event)=>{const file=event.target.files?.[0];event.target.value="";if(file)void perform(async()=>{if(file.size>72*1024*1024)throw new Error("Pacote muito grande.");await installPack(parsePack(JSON.parse(await file.text())));});}}/>
{error&&<p className="expression-error" role="alert">{error}</p>}{busy&&<p role="status">Salvando coleção…</p>}</section>;
}
