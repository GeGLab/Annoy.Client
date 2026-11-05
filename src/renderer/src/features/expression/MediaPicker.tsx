import { t as translate, localizationPreferences } from "../../../../shared/localization/index.ts";
import * as Popover from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import { Smile, Search, Settings2, X } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { openModal } from "../../components/ui.tsx";
import { EMOJIS, readItemPage, readMediaBlob, type MediaItem, type MediaKind } from "./library.ts";
import { GiphyAttribution, GifsUnavailable, giphyImage, searchGiphy, type GiphyItem } from "./giphy.tsx";
import { registerMediaPicker } from "./navigation.ts";
import { annoyImage, readAnnoyItems } from "./annoy-set.ts";

export function ItemImage({ item }: { item: MediaItem }) {
  const [url,setUrl] = useState(item.remote ? undefined : item.url);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    setUrl(item.remote ? undefined : item.url);
    if (item.emoji || (!item.blob && !item.packId && !item.remote)) return;
    let disposed = false, objectUrl: string | undefined;
    const show = async () => {
      const blob = item.blob ?? (item.remote ? await annoyImage(item.url!) : await readMediaBlob(item.packId!, item.id));
      if (!disposed && blob) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect(); void show().catch(() => undefined);
    });
    if (image.current) observer.observe(image.current);
    return () => { disposed = true; observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [item.id,item.packId,item.blob,item.url,item.emoji,item.remote]);
  return item.emoji ? <span>{item.emoji}</span> : <img ref={image} src={url} alt="" loading="lazy" />;
}
const matches = (item: MediaItem, query: string) => `${item.name} ${item.emoji ?? ""}`.normalize("NFD").replace(/\p{M}/gu,"").toLocaleLowerCase(localizationPreferences().region).includes(query.normalize("NFD").replace(/\p{M}/gu,"").toLocaleLowerCase(localizationPreferences().region));
export function EmojiMenu({ onSelect, disabled=false }: { onSelect: (emoji: string) => void; disabled?: boolean }) {
  const [open,setOpen]=useState(false), [query,setQuery]=useState(""), [expanded,setExpanded]=useState(false);
  const common = ["😂", "❤️", "👍", "🔥", "👀", "🎉", "😢", "👏", "😀", "🥰", "🤔", "😳", "💀", "🙏", "✅", "💪"];
  const items = query.trim() || expanded ? EMOJIS.filter((item)=>matches(item,query)) : common.flatMap((emoji)=>EMOJIS.filter((item)=>item.emoji===emoji));
  return <Popover.Root open={open} onOpenChange={(value)=>{setOpen(value);if(value){setQuery("");setExpanded(false);}}}><Popover.Trigger asChild><button className="icon-btn tiny" aria-label={translate("expression.3fabbf2c1eb1")} title={translate("expression.3fabbf2c1eb1")} disabled={disabled}><Smile size={16} /></button></Popover.Trigger><Popover.Portal><Popover.Content side="top" align="end" collisionPadding={{ top: 48, right: 12, bottom: 12, left: 12 }} sideOffset={8} className="expression-picker reaction-picker" role="dialog" aria-label={translate("expression.76f20d93f109")}><Input aria-label={translate("expression.e18752d70c23")} placeholder={translate("expression.9306b76a82a0")} value={query} onChange={(event)=>setQuery(event.target.value)} /><div className="expression-grid emoji-grid">{items.map((item)=><button key={item.id} title={item.name} aria-label={item.name} onClick={()=>{onSelect(item.emoji!);setOpen(false);}}>{item.emoji}</button>)}</div>{!items.length&&<p className="muted small">{translate("expression.d26bebda6099")}</p>}{!query.trim()&&<Button variant="ghost" size="sm" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?translate("expression.677b6ee8c1b5"):translate("expression.7e9151435083")}</Button>}<Popover.Arrow className="popover-arrow" /></Popover.Content></Popover.Portal></Popover.Root>;
}

export function MediaPicker({accountId,canAttach,onEmoji,onFile,onLink,onSticker,disabled=false}:{accountId:string;canAttach:boolean;onEmoji:(emoji:string)=>void;onFile:(file:File)=>void;onLink:(link:string)=>void;/** Sends an Annoy sticker right away, as its own message. */onSticker?:(url:string)=>void;disabled?:boolean}) {
  const [open,setOpen]=useState(false), [tab,setTab]=useState<MediaKind>("emoji"), [query,setQuery]=useState("");
  const [localItems,setLocalItems]=useState<MediaItem[]>([]), [error,setError]=useState<string|null>(null);
  const [localNext,setLocalNext]=useState<string|null>(null), [localLoading,setLocalLoading]=useState(false);
  const [localCursor,setLocalCursor]=useState<string|null>(null), [previous,setPrevious]=useState<(string|null)[]>([]), [retry,setRetry]=useState(0);
  const selection = useRef(0), openRef = useRef(open), selecting = useRef(false);
  openRef.current = open;
  const [provider,setProvider]=useState<"local"|"giphy">("local"), [unavailable,setUnavailable]=useState(false);
  const [annoyItems,setAnnoyItems]=useState<MediaItem[]>([]);
  // The Annoy set comes from the local cache; cdnannoy is asked at most every 2 hours.
  useEffect(()=>{
    setAnnoyItems([]);
    if(!open||(tab==="gif"&&provider==="giphy"))return;
    let disposed=false;
    void readAnnoyItems(tab,query).then((items)=>{if(!disposed)setAnnoyItems(items);}).catch(()=>undefined);
    return()=>{disposed=true;};
  },[open,tab,query,provider]);
  const [results,setResults]=useState<GiphyItem[]>([]), [loading,setLoading]=useState(false), [offset,setOffset]=useState(0), [more,setMore]=useState(false);
  useEffect(()=>{selection.current++;setLocalCursor(null);setPrevious([]);setLocalItems([]);},[open,tab,query,accountId]);
  useEffect(()=>{
    if(!open || (tab==="gif"&&provider==="giphy"))return;
    let disposed=false;setLocalLoading(true);setError(null);
    const timer=setTimeout(()=>void readItemPage({kind:tab,query,after:localCursor}).then((page)=>{if(!disposed){setLocalItems(page.items);setLocalNext(page.next);}}).catch((error)=>{if(!disposed)setError(error.message);}).finally(()=>{if(!disposed)setLocalLoading(false);}),150);
    return()=>{disposed=true;clearTimeout(timer);};
  },[open,tab,query,localCursor,accountId,provider,retry]);
  useEffect(()=>{
    if (!open || tab!=="gif" || provider!=="giphy") return;
    const controller=new AbortController(); setLoading(true);setError(null);setUnavailable(false);
    const timer=setTimeout(()=>void searchGiphy(query,controller.signal,offset).then((response)=>{setResults(response.data);setMore(response.pagination.offset+response.pagination.count<response.pagination.total_count);}).catch((error)=>{if(controller.signal.aborted)return;if(error instanceof GifsUnavailable){setUnavailable(true);setResults([]);}else setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);}),300);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[open,tab,provider,query,offset]);
  const select=async(item:MediaItem)=>{
    if(selecting.current)return;
    selecting.current=true;const generation=selection.current;
    try{
      if(item.emoji)onEmoji(item.emoji);
      else if(item.remote&&item.url)(onSticker??onLink)(item.url);
      else if(canAttach){
        const blob=item.blob??(item.remote?await annoyImage(item.url!):item.packId?await readMediaBlob(item.packId,item.id):undefined);
        if(!openRef.current||generation!==selection.current)return;
        if(!blob)throw new Error(translate("expression.catalog.0e4253803953"));
        onFile(new File([blob],`${item.name.replace(/[^\p{L}\p{N}_ -]/gu,"")||"figurinha"}.${blob.type.split("/")[1]}`,{type:blob.type}));
      }else return;
      setOpen(false);
    }catch(error){if(openRef.current&&generation===selection.current)setError((error as Error).message);}
    finally{selecting.current=false;}
  };
  const configure=()=>{setOpen(false);openModal({kind:"userSettings",section:"expressions"});};
  useEffect(()=>{if(disabled)return;return registerMediaPicker((kind)=>{setTab(kind);setProvider("local");setQuery("");setOpen(true);});},[disabled]);
  const shown=[...(tab==="emoji"&&!localCursor?[{id:"unicode",name:translate("common.0a76ba756cf5"),items:EMOJIS.filter((item)=>matches(item,query))}]:[]),...(!localCursor?[{id:"annoy",name:"Annoy",items:annoyItems}]:[]),{id:"installed",name:translate("expression.308b5f1f24ae"),items:localItems}].filter((pack)=>pack.items.length);
  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger asChild><button className="icon-btn" aria-label={translate("expression.85c26e075670")} title={translate("expression.85c26e075670")} disabled={disabled}><Smile size={21}/></button></Popover.Trigger><Popover.Portal><Popover.Content className="expression-picker" side="top" align="end" sideOffset={12} collisionPadding={{ top: 48, right: 12, bottom: 12, left: 12 }} role="dialog" aria-label={translate("expression.85c26e075670")}>
    <header><div className="expression-tabs" role="tablist" aria-label={translate("expression.608b6375cba5")} onKeyDown={(event)=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));const index=buttons.indexOf(document.activeElement as HTMLButtonElement);const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowRight"?1:buttons.length-1))%buttons.length;buttons[next]?.focus();buttons[next]?.click();}}>{([['emoji',translate("common.0a76ba756cf5")],['gif',translate("common.c275c265cabd")],['sticker',translate("expression.3076a998ce59")]] as const).map(([id,label])=><button role="tab" tabIndex={tab===id?0:-1} aria-selected={tab===id} key={id} onClick={()=>{setTab(id);setQuery("");setError(null);setOffset(0);}}>{label}</button>)}</div><Popover.Close className="icon-btn tiny" aria-label={translate("expression.fe2d6306c0ae")}><X size={16}/></Popover.Close></header>
    <div className="expression-search"><Search size={15}/><Input aria-label={translate("expression.bd6597a8ed71")} placeholder={tab==="emoji"?translate("expression.9306b76a82a0"):tab==="gif"?translate("expression.3b16eb2ec247"):translate("expression.1f83655213c6")} value={query} onChange={(event)=>{setQuery(event.target.value);setOffset(0);}}/></div>
    {tab==="gif"&&<div className="expression-sources"><button aria-pressed={provider==="local"} onClick={()=>setProvider("local")}>{translate("expression.308b5f1f24ae")}</button><button aria-pressed={provider==="giphy"} onClick={()=>setProvider("giphy")}>{translate("expression.f4c143cc3c8a")}</button></div>}
    {error&&<p className="expression-error" role="alert">{error}</p>}
    <div className="expression-scroll" role="tabpanel" aria-label={tab==="emoji"?translate("common.0a76ba756cf5"):tab==="gif"?translate("common.c275c265cabd"):translate("expression.3076a998ce59")}>
      {tab==="gif"&&provider==="giphy"?<>{unavailable?<div className="expression-empty"><h3>{translate("expression.gifsUnavailable")}</h3><p>{translate("expression.gifsUnavailableHint")}</p></div>:<>{loading?<p role="status">{translate("expression.0d5d7807ade9")}</p>:<><div className="expression-grid gif-grid">{results.map((item)=><button key={item.id} aria-label={item.title||translate("expression.7e879fd88e9f")} onClick={()=>{onLink(`https://giphy.com/gifs/${item.id}`);setOpen(false);}}><img src={giphyImage(item.images.fixed_height.url)} alt={item.title||"GIF"} loading="lazy"/></button>)}</div>{!results.length&&<p className="expression-empty">{translate("expression.5cad2e6c7328")}</p>}<div className="expression-pagination"><Button variant="ghost" size="sm" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-24))}>{translate("expression.e4ce7c09d51e")}</Button><Button variant="ghost" size="sm" disabled={!more} onClick={()=>setOffset(offset+24)}>{translate("expression.6a69f6cbda7d")}</Button></div></>}</>}</>
      :localLoading?<p role="status">{translate("expression.catalog.9abc0a44cfc9")}</p>:shown.length?shown.map((pack)=><section className="expression-group" key={pack.id}><h3>{pack.name}</h3><div className={`expression-grid ${tab==="emoji"?"emoji-grid":"sticker-grid"}`}>{pack.items.map((item)=><button disabled={!item.emoji&&!item.remote&&!canAttach} key={item.id} title={item.name} aria-label={item.name} onClick={()=>select(item)}><ItemImage item={item}/></button>)}</div></section>):<div className="expression-empty"><h3>{query?translate("expression.4410f3299961"):translate("expression.ff0d5f1589ec")}</h3><p>{query?translate("expression.7f749b381c58"):translate("expression.959e3274ae92")}</p><Button variant="secondary" size="sm" onClick={configure}>{translate("expression.c3a348ac95b4")}</Button></div>}
      {!(tab==="gif"&&provider==="giphy")&&<div className="expression-pagination"><Button variant="ghost" size="sm" disabled={localLoading||!previous.length} onClick={()=>{setLocalCursor(previous.at(-1)??null);setPrevious(previous.slice(0,-1));}}>{translate("expression.e4ce7c09d51e")}</Button><Button variant="ghost" size="sm" disabled={localLoading||!localNext} onClick={()=>{setPrevious([...previous,localCursor]);setLocalCursor(localNext);}}>{translate("expression.6a69f6cbda7d")}</Button>{error&&<Button variant="ghost" size="sm" onClick={()=>setRetry(retry+1)}>{translate("common.b9e10688be01")}</Button>}</div>}
    </div><footer className="expression-picker-footer">{tab==="gif"&&provider==="giphy"&&!unavailable?<a href="https://giphy.com" target="_blank" rel="noreferrer"><GiphyAttribution /></a>:<span>{tab==="emoji"?translate("expression.d605da223795"):translate("expression.3d891062cde6")}</span>}<button className="expression-manage" onClick={configure}><Settings2 size={15}/>{translate("expression.d16b07d89d7d")}</button></footer>
  </Popover.Content></Popover.Portal></Popover.Root>;
}
