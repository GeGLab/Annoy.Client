import {rich} from "../../lib/localization.ts";
import {t as translate} from "../../../../shared/localization/index.ts";
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
    if(files.length>60)throw new Error(translate("expression.ba7125c0739e"));
    const current=packs.find((pack)=>pack.id==="my-media");
    const items=[...(current?.items??[])];
    for(const file of files){if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>8*1024*1024)throw new Error(translate("expression.573bbd6552b3"));items.push({id:crypto.randomUUID(),name:file.name.slice(0,80),kind:file.type==="image/gif"?"gif":"sticker",blob:file});}
    if(items.length>60)throw new Error(translate("expression.553388ab5365"));
    if(items.reduce((sum,item)=>sum+(item.blob?.size??0),0)>50*1024*1024)throw new Error(translate("expression.96198a4fa625"));
    await savePack({id:"my-media",name:translate("expression.d35e38529430"),author:translate("expression.b21e91730d18"),license:translate("expression.d3b5f6f85fa5"),source:"local",items});
  };
  return <section className="settings-section media-library-settings"><h3>{rich("common.49c93db05f0a",{p0:(<Icon name="image" size={24} />)})}</h3><p className="muted">{translate("expression.329247f8301b")}</p>{!canUse&&<p className="muted small">{translate("expression.05ff9ad4a4e5")}</p>}<h4>{translate("expression.d79e510271e4")}</h4>
        {CATALOG.map((pack)=><article className="expression-pack" key={pack.id}><div className="expression-pack-preview">{pack.items.slice(0,3).map((item)=><ItemImage key={item.id} item={item}/>)}</div><div><strong>{pack.name}</strong><small>{rich("common.a695fe3e74b5",{p0:(pack.items.length),p1:(pack.author)})}</small><small>{pack.license} · <a href={pack.source} target="_blank" rel="noreferrer">{translate("expression.7b9afa8bda07")}</a></small></div><Button variant="secondary" size="sm" disabled={busy || (!canUse && packs.some((saved)=>saved.id===pack.id))} onClick={()=>packs.some((saved)=>saved.id===pack.id)?usePack(pack):void perform(()=>installPack(pack))}><Download size={14}/>{packs.some((saved)=>saved.id===pack.id)?translate("expression.820eaa6af764"):translate("expression.b45ae836a031")}</Button></article>)}
        <div className="expression-import-actions"><Button variant="secondary" size="sm" disabled={busy} onClick={()=>input.current?.click()}><ImagePlus size={15}/>{translate("expression.c8630e10d977")}</Button><Button variant="secondary" size="sm" disabled={busy} onClick={()=>manifest.current?.click()}><Upload size={15}/>{translate("expression.99e439de4649")}</Button></div>
        {packs.length>0&&<section className="expression-installed"><h4>{translate("expression.8a8b5ccdce78")}</h4>{packs.map((pack)=><div key={pack.id}><span><strong>{pack.name}</strong><small>{rich("common.7bc0326c3ea3",{p0:(pack.items.length),p1:(pack.author),p2:(pack.license)})}</small></span><Button variant="secondary" size="sm" disabled={busy || !canUse} title={canUse?translate("expression.c4300c0d9b9d"):translate("expression.f444111ae64f")} onClick={()=>usePack(pack)} aria-label={translate("expression.b4d5dd78d97a",{p0:(pack.name)})}>{translate("expression.820eaa6af764")}</Button><button className="icon-btn tiny" aria-label={translate("expression.6fe9ceb2e844",{p0:(pack.name)})} disabled={busy} onClick={()=>void perform(async()=>{const blob=await exportPack(pack),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`${pack.name}.annoy-pack.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})}><Download size={15}/></button><button className="icon-btn tiny danger" aria-label={translate("expression.82e85db7347e",{p0:(pack.name)})} disabled={busy} onClick={()=>void confirmAction(translate("expression.0cfa0682461b",{p0:(pack.name)})).then((yes)=>{if(yes)return perform(()=>removePack(pack.id));})}><Trash2 size={15}/></button></div>)}</section>}
        <details className="expression-provider-config"><summary>{translate("expression.53bb27a0bc2f")}</summary><div className="expression-provider-fields"><p>{translate("expression.21cdaac4204c")}</p><Input aria-label={translate("expression.8659385eb30a")} value={draftKey} onChange={(event)=>setDraftKey(event.target.value)} placeholder={translate("expression.49b75b432f76")}/><Button variant="secondary" size="sm" onClick={()=>{setGiphyKey(draftKey);toast(translate("expression.b51aec3ac697"));}}>{translate("expression.6b46278c426a")}</Button></div></details>
        <input ref={input} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif" aria-label={translate("expression.1cdcd529e1bd")} onChange={(event)=>{const files=Array.from(event.target.files??[]);event.target.value="";if(files.length)void perform(()=>importFiles(files));}}/>
        <input ref={manifest} type="file" hidden accept="application/json,.json" aria-label={translate("expression.d482bda7242d")} onChange={(event)=>{const file=event.target.files?.[0];event.target.value="";if(file)void perform(async()=>{if(file.size>72*1024*1024)throw new Error(translate("expression.989bf059022b"));await installPack(parsePack(JSON.parse(await file.text())));});}}/>
{error&&<p className="expression-error" role="alert">{error}</p>}{busy&&<p role="status">{translate("expression.64ae1382e081")}</p>}</section>;
}




