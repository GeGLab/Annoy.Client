import {t as translate} from "../../../shared/localization/index.ts";
import { m } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { formatSize } from "../format.tsx";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Button, buttonVariants } from "./ui/button.tsx";
import { Icon, type IconName } from "./ui.tsx";
import { openOriginalImage } from "../lib/original-image.ts";
import { useAttachTarget } from "../lib/composer-attach.ts";
import { toast } from "../store.ts";
import { COLORS, EMPTY_EDIT, SIZES, clampRect, drawLayer, flatten, meaningful, nextCounter, rectOf, textFont, textLineHeight, type Edit, type Point, type Rect, type Shape, type Tool } from "./viewer/annotate.ts";

export interface ViewerImage { id: string; url: string; filename: string; size: number }

type History = { stack: Edit[]; index: number };
type TextEntry = { at: Point; value: string };
const TOOLS: { tool: Tool; icon: IconName; key: string }[] = [
  { tool: "pan", icon: "hand", key: "V" },
  { tool: "pen", icon: "pen", key: "P" },
  { tool: "line", icon: "line", key: "L" },
  { tool: "arrow", icon: "arrow", key: "A" },
  { tool: "rect", icon: "square", key: "R" },
  { tool: "ellipse", icon: "circle", key: "E" },
  { tool: "marker", icon: "highlighter", key: "M" },
  { tool: "text", icon: "text", key: "T" },
  { tool: "pixelate", icon: "pixelate", key: "B" },
  { tool: "counter", icon: "counter", key: "N" },
  { tool: "crop", icon: "crop", key: "X" },
];
const TEXT_SIZES = [16, 22, 32] as const;
const FRAME_MARGIN = 16, BAR_HEIGHT = 44, PALETTE_HEIGHT = 52;
const COUNTER_SIZES = [11, 14, 18] as const;
const PIXEL_SIZES = [8, 12, 18] as const;
const SIZE_LABELS = ["image.sizeThin", "image.sizeMedium", "image.sizeThick"] as const;

/** Holding Shift keeps lines at 45° steps and boxes square, as screenshot tools do. */
function constrain(kind: Shape["kind"] | "crop", from: Point, to: Point): Point {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (kind === "line" || kind === "arrow") {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), length = Math.hypot(dx, dy);
    return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: from.x + Math.sign(dx || 1) * side, y: from.y + Math.sign(dy || 1) * side };
}

const baseName = (filename: string) => filename.replace(/\.[^.]+$/, "") || "imagem";

/** Loaded only when an attachment is opened; no image data is copied into global state. */
export default function ImageViewer({ images, initialIndex, onClose }: { images: ViewerImage[]; initialIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [screen, setScreen] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [size, setSize] = useState(1);
  const [histories, setHistories] = useState<Record<string, History>>({});
  const [draft, setDraft] = useState<Shape | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [textEntry, setTextEntry] = useState<TextEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const zoomRef = useRef(1);
  const imageRef = useRef<HTMLImageElement>(null);
  const layerRef = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{ from: Point; scroll?: { left: number; top: number; x: number; y: number } } | null>(null);
  const sources = useRef(new Map<string, Promise<Blob>>());
  const attachTarget = useAttachTarget();
  const current = images[index]!;
  const history = histories[current.id] ?? { stack: [EMPTY_EDIT], index: 0 };
  const edit = history.stack[history.index]!;
  const edited = edit.shapes.length > 0 || !!edit.crop;

  const move = (step: number) => {
    setIndex(i => Math.max(0, Math.min(images.length - 1, i + step)));
    setZoom(1); setNatural({ width: 0, height: 0 }); setFailed(false); setDraft(null); setCropDraft(null); setTextEntry(null);
  };
  useEffect(() => {
    const resized = () => setScreen({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  // The viewer hugs the picture: a thin bar over it, the tool palette under it
  // while editing, and never more than the window leaves around it.
  const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-height")) || 44;
  const palette = editing ? PALETTE_HEIGHT : 0;
  const room = { width: Math.max(200, screen.width - FRAME_MARGIN * 2 - 2), height: Math.max(160, screen.height - topbar - FRAME_MARGIN * 2 - BAR_HEIGHT - palette - 2) };
  const fit = natural.width ? Math.max(.01, Math.min(1, room.width / natural.width, room.height / natural.height)) : 1;
  const scale = fit * zoom;
  const frame: CSSProperties = natural.width
    ? { width: Math.min(room.width, Math.max(editing ? 900 : 640, Math.ceil(natural.width * fit))) + 2, height: BAR_HEIGHT + palette + Math.max(220, Math.ceil(natural.height * fit)) + 2 }
    : { width: Math.min(room.width, 640) + 2, height: BAR_HEIGHT + palette + Math.min(room.height, 380) + 2 };
  const loading = !natural.width && !failed;
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    if (!viewport || loading || failed) return;
    let frame = 0;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const previous = zoomRef.current;
      const next = Math.min(4, Math.max(1, previous * Math.exp(-event.deltaY * (event.deltaMode === 1 ? .025 : .002))));
      zoomRef.current = next;
      const rect = viewport.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const targetX = (viewport.scrollLeft + x) * next / previous - x;
      const targetY = (viewport.scrollTop + y) * next / previous - y;
      setZoom(next);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { viewport.scrollLeft = Math.max(0, targetX); viewport.scrollTop = Math.max(0, targetY); });
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => { viewport.removeEventListener("wheel", wheel); cancelAnimationFrame(frame); };
  }, [viewport, loading, failed]);

  // The annotation layer is redrawn whenever shapes change; the image itself stays an <img>.
  useLayoutEffect(() => {
    const canvas = layerRef.current, image = imageRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !image || !natural.width) return;
    drawLayer(ctx, image, draft ? [...edit.shapes, draft] : edit.shapes);
  }, [edit, draft, natural]);

  const commit = (next: Edit) => setHistories(all => {
    const h = all[current.id] ?? { stack: [EMPTY_EDIT], index: 0 };
    return { ...all, [current.id]: { stack: [...h.stack.slice(0, h.index + 1), next], index: h.index + 1 } };
  });
  const step = (by: number) => setHistories(all => {
    const h = all[current.id];
    if (!h) return all;
    return { ...all, [current.id]: { ...h, index: Math.max(0, Math.min(h.stack.length - 1, h.index + by)) } };
  });
  const canUndo = history.index > 0, canRedo = history.index < history.stack.length - 1;

  // Blur and the next click can both finish the same text; only the first one keeps it.
  const pendingText = useRef<TextEntry | null>(null);
  pendingText.current = textEntry;
  const commitText = () => {
    const entry = pendingText.current;
    pendingText.current = null;
    setTextEntry(null);
    if (!entry) return;
    const shape: Shape = { kind: "text", color, size: TEXT_SIZES[size]! / scale, at: entry.at, text: entry.value.replace(/\s+$/, "") };
    if (meaningful(shape, scale)) commit({ ...edit, shapes: [...edit.shapes, shape] });
  };

  const pointOf = (event: { clientX: number; clientY: number }): Point => {
    const rect = layerRef.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * natural.width / rect.width, y: (event.clientY - rect.top) * natural.height / rect.height };
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!editing || event.button !== 0) return;
    event.preventDefault();
    const at = pointOf(event);
    if (textEntry) { commitText(); if (tool === "text") return; }
    if (tool === "text") { setTextEntry({ at, value: "" }); return; }
    if (tool === "counter") {
      commit({ ...edit, shapes: [...edit.shapes, { kind: "counter", color, size: COUNTER_SIZES[size]! / scale, at, n: nextCounter(edit) }] });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = tool === "pan" && viewport ? { from: at, scroll: { left: viewport.scrollLeft, top: viewport.scrollTop, x: event.clientX, y: event.clientY } } : { from: at };
    const width = SIZES[size]! / scale;
    if (tool === "pen" || tool === "marker") setDraft({ kind: tool, color, width, points: [at] });
    else if (tool === "line" || tool === "arrow" || tool === "rect" || tool === "ellipse") setDraft({ kind: tool, color, width, from: at, to: at });
    else if (tool === "pixelate") setDraft({ kind: "pixelate", block: PIXEL_SIZES[size]! / scale, from: at, to: at });
    else if (tool === "crop") setCropDraft({ ...at, width: 0, height: 0 });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const start = gesture.current;
    if (!start) return;
    if (start.scroll && viewport) {
      viewport.scrollLeft = start.scroll.left - (event.clientX - start.scroll.x);
      viewport.scrollTop = start.scroll.top - (event.clientY - start.scroll.y);
      return;
    }
    const raw = pointOf(event);
    if (tool === "crop") {
      const to = event.shiftKey ? constrain("crop", start.from, raw) : raw;
      setCropDraft(clampRect(rectOf(start.from, to), natural));
      return;
    }
    setDraft(shape => {
      if (!shape) return shape;
      if (shape.kind === "pen" || shape.kind === "marker") return { ...shape, points: [...shape.points, raw] };
      if ("from" in shape) return { ...shape, to: event.shiftKey ? constrain(shape.kind, shape.from, raw) : raw };
      return shape;
    });
  };
  const onPointerUp = () => {
    const start = gesture.current;
    gesture.current = null;
    if (!start || start.scroll) return;
    if (tool === "crop") {
      const crop = cropDraft;
      setCropDraft(null);
      // A click without dragging removes the crop.
      if (crop && crop.width * scale > 4 && crop.height * scale > 4) commit({ ...edit, crop });
      else if (edit.crop) commit({ ...edit, crop: null });
      return;
    }
    if (draft && meaningful(draft, scale)) commit({ ...edit, shapes: [...edit.shapes, draft] });
    setDraft(null);
  };

  const source = (image: ViewerImage) => {
    let pending = sources.current.get(image.id);
    if (!pending) {
      pending = fetch(image.url).then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      });
      pending.catch(() => sources.current.delete(image.id));
      sources.current.set(image.id, pending);
    }
    return pending;
  };
  /** The picture as shown: the original file, or a PNG with the annotations and crop applied. */
  const result = async (png: boolean): Promise<{ blob: Blob; name: string }> => {
    // Decrypted attachments are local blob: URLs, which the page may not fetch()
    // (CSP); the picture on screen is same-origin and can be drawn instead.
    const local = /^(blob|data):/.test(current.url) && imageRef.current;
    const original = local ? null : await source(current);
    if (original && !edited && (!png || original.type === "image/png")) return { blob: original, name: current.filename };
    const picture = local || await createImageBitmap(original!);
    try {
      const blob = await flatten(picture, natural, edit);
      return { blob, name: `${baseName(current.filename)}${edited ? `-${translate("image.editedSuffix")}` : ""}.png` };
    } finally { if (picture instanceof ImageBitmap) picture.close(); }
  };
  const run = async (action: () => Promise<void>) => {
    if (busy || loading || failed) return;
    if (textEntry) commitText();
    setBusy(true);
    try { await action(); } catch { toast(translate("image.exportFailed")); } finally { setBusy(false); }
  };
  const copy = () => run(async () => {
    const { blob } = await result(true);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast(translate("image.copied"));
  });
  const save = () => run(async () => {
    const { blob, name } = await result(false);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  const attach = () => run(async () => {
    if (!attachTarget) return;
    const { blob, name } = await result(false);
    attachTarget([new File([blob], name, { type: blob.type || "image/png" })]);
    toast(translate("image.attached"));
    onClose();
  });

  const display = { width: Math.max(1, natural.width * scale), height: Math.max(1, natural.height * scale) };
  const percent = (rect: Rect): CSSProperties => ({ left: `${rect.x / natural.width * 100}%`, top: `${rect.y / natural.height * 100}%`, width: `${rect.width / natural.width * 100}%`, height: `${rect.height / natural.height * 100}%` });
  const crop = cropDraft ?? edit.crop;
  const label = (name: string) => translate(`image.tool.${name}` as Parameters<typeof translate>[0]);

  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent className={`image-viewer${editing ? " editing" : ""}`} style={frame} showClose={false} aria-describedby={undefined}
    onEscapeKeyDown={event => {
      if (textEntry) { event.preventDefault(); setTextEntry(null); }
      else if (editing) { event.preventDefault(); setEditing(false); }
    }}
    onKeyDown={event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && !event.altKey) {
        if (key === "z" && !event.shiftKey) { event.preventDefault(); step(-1); }
        else if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); step(1); }
        else if (key === "c" && !window.getSelection()?.toString()) { event.preventDefault(); void copy(); }
        else if (key === "s") { event.preventDefault(); void save(); }
        return;
      }
      if (event.altKey) return;
      if (event.key === "ArrowRight" && index < images.length - 1) { event.preventDefault(); move(1); }
      if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); move(-1); }
      if (event.key === "+" || event.key === "=") { event.preventDefault(); setZoom(z => Math.min(4, z + .5)); }
      if (event.key === "-") { event.preventDefault(); setZoom(z => Math.max(1, z - .5)); }
      if (!editing || event.target instanceof HTMLButtonElement && (event.key === " " || event.key === "Enter")) return;
      const picked = TOOLS.find(entry => entry.key.toLowerCase() === key);
      if (picked) { event.preventDefault(); setTool(picked.tool); }
    }}>
    <header className="viewer-bar">
      <span className="viewer-file-icon"><Icon name="image" size={17} /></span>
      <div className="viewer-file-info"><DialogTitle className="truncate">{current.filename}</DialogTitle><span className="muted small">{formatSize(current.size)}{natural.width > 0 && translate("common.6d4ae0e6e37d",{p0:(natural.width),p1:(natural.height)})}</span></div>
      {images.length > 1 && <div className="viewer-tools">
        <Button variant="ghost" size="icon" disabled={index === 0} onClick={() => move(-1)} aria-label={translate("common.3f4837fc17cc")}><Icon name="left" /></Button>
        <span className="viewer-count" aria-live="polite">{translate("common.aed1f8f95cfc",{p0:(index + 1),p1:(images.length)})}</span>
        <Button variant="ghost" size="icon" disabled={index === images.length - 1} onClick={() => move(1)} aria-label={translate("common.36f99970853d")}><Icon name="right" /></Button>
        <span className="viewer-tool-divider" />
      </div>}
      <div className="viewer-tools">
        <Button variant="ghost" size="icon" disabled={zoom <= 1 || loading || failed} onClick={() => setZoom(z => Math.max(1, z - .5))} aria-label={translate("common.1ef7f35020ad")}><Icon name="zoomOut" /></Button>
        <Button variant="ghost" className="viewer-zoom" disabled={loading || failed} onClick={() => setZoom(1)} aria-label={translate("common.c3a949106aa5")}>{Math.round(zoom * 100)}%</Button>
        <Button variant="ghost" size="icon" disabled={zoom >= 4 || loading || failed} onClick={() => setZoom(z => Math.min(4, z + .5))} aria-label={translate("common.d24683d859c9")}><Icon name="zoomIn" /></Button>
        <span className="viewer-tool-divider" />
        <Button variant="ghost" size="icon" className="viewer-edit-toggle" aria-pressed={editing} disabled={loading || failed} onClick={() => { if (editing) commitText(); setEditing(value => !value); }} aria-label={translate("image.edit")} title={translate("image.edit")}><Icon name="edit" /></Button>
        <Button variant="ghost" size="icon" disabled={busy || loading || failed} onClick={() => void copy()} aria-label={translate("image.copy")} title={`${translate("image.copy")} (Ctrl+C)`}><Icon name="copy" /></Button>
        <Button variant="ghost" size="icon" disabled={busy || loading || failed} onClick={() => void save()} aria-label={translate("image.save")} title={`${translate("image.save")} (Ctrl+S)`}><Icon name="download" /></Button>
        {attachTarget && <Button variant="ghost" size="icon" disabled={busy || loading || failed} onClick={() => void attach()} aria-label={translate("image.attach")} title={translate("image.attach")}><Icon name="send" /></Button>}
        <a className={`${buttonVariants({ variant: "ghost", size: "icon" })} viewer-original`} href={current.url} target="_blank" rel="noreferrer" aria-label={translate("image.openOriginal")} title={translate("image.openOriginal")} onClick={event => {
          if (!/^(blob|data):/.test(current.url)) return;
          event.preventDefault();
          void openOriginalImage(current.url, current.filename).catch(() => toast(translate("image.originalFailed")));
        }}><Icon name="external" /></a>
        <span className="viewer-tool-divider" />
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={translate("common.b974b441c683")}><Icon name="x" /></Button>
      </div>
    </header>
    <div className="viewer-viewport" ref={setViewport}>
      {loading && <div className="viewer-status" role="status"><Icon name="loader" size={24} /><span>{translate("common.c7ad73ae4ace")}</span></div>}
      {failed ? <div className="viewer-status" role="alert"><Icon name="image" size={40} /><h2>{translate("common.5ac3515bb187")}</h2><p className="muted">{translate("common.ec3fe65bf481")}</p><Button variant="secondary" onClick={() => { setFailed(false); setAttempt(a => a + 1); }}>{translate("common.b9e10688be01")}</Button></div> : <m.div className="viewer-canvas" initial={{ opacity: .65 }} animate={{ opacity: 1 }} transition={{ duration: .18 }} key={current.id}>
        <div className="viewer-stage" style={natural.width ? display : undefined}>
          <img ref={imageRef} key={`${current.id}-${attempt}`} src={current.url} alt={current.filename} draggable={false} onLoad={e => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} onError={() => setFailed(true)} style={natural.width ? display : { visibility: "hidden" }} />
          {natural.width > 0 && <canvas ref={layerRef} className={`viewer-layer tool-${tool}`} width={natural.width} height={natural.height} aria-hidden style={{ pointerEvents: editing ? "auto" : "none" }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />}
          {crop && natural.width > 0 && <div className="viewer-crop" style={percent(crop)} />}
          {textEntry && <textarea className="viewer-text-entry" autoFocus rows={1} aria-label={label("text")} placeholder={translate("image.textPlaceholder")} value={textEntry.value}
            style={{ left: textEntry.at.x * scale, top: textEntry.at.y * scale, color, font: textFont(TEXT_SIZES[size]!), lineHeight: `${textLineHeight(TEXT_SIZES[size]!)}px` }}
            onChange={event => setTextEntry({ ...textEntry, value: event.target.value })}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); commitText(); }
            }}
            onBlur={() => commitText()} />}
        </div>
      </m.div>}
    </div>
    {editing && <div className="annotate-bar" role="toolbar" aria-label={translate("image.tools")}>
      <div className="annotate-group">
        {TOOLS.map(entry => <button key={entry.tool} type="button" className="annotate-tool" aria-pressed={tool === entry.tool} aria-label={label(entry.tool)} title={`${label(entry.tool)} (${entry.key})`} onClick={() => { commitText(); setTool(entry.tool); }}><Icon name={entry.icon} size={17} /></button>)}
      </div>
      <span className="annotate-divider" />
      <div className="annotate-group annotate-colors">
        {COLORS.map(value => <button key={value} type="button" className="annotate-swatch" style={{ "--swatch": value } as CSSProperties} aria-pressed={color === value} aria-label={translate("image.color", { p0: value })} onClick={() => setColor(value)} />)}
        <label className={`annotate-swatch annotate-custom${COLORS.includes(color as typeof COLORS[number]) ? "" : " selected"}`} style={{ "--swatch": color } as CSSProperties} title={translate("image.customColor")}>
          <Icon name="pipette" size={13} />
          <input type="color" aria-label={translate("image.customColor")} value={color} onChange={event => setColor(event.target.value)} />
        </label>
      </div>
      <span className="annotate-divider" />
      <div className="annotate-group">
        {SIZES.map((value, i) => <button key={value} type="button" className="annotate-tool annotate-size" aria-pressed={size === i} aria-label={translate(SIZE_LABELS[i]!)} title={translate(SIZE_LABELS[i]!)} onClick={() => setSize(i)}><span style={{ width: value + 3, height: value + 3 }} /></button>)}
      </div>
      <span className="annotate-divider" />
      <div className="annotate-group">
        <button type="button" className="annotate-tool" disabled={!canUndo} aria-label={translate("image.undo")} title={`${translate("image.undo")} (Ctrl+Z)`} onClick={() => step(-1)}><Icon name="undo" size={17} /></button>
        <button type="button" className="annotate-tool" disabled={!canRedo} aria-label={translate("image.redo")} title={`${translate("image.redo")} (Ctrl+Shift+Z)`} onClick={() => step(1)}><Icon name="redo" size={17} /></button>
        <button type="button" className="annotate-tool" disabled={!edited} aria-label={translate("image.clear")} title={translate("image.clear")} onClick={() => commit(EMPTY_EDIT)}><Icon name="trash" size={17} /></button>
      </div>
    </div>}
  </DialogContent></Dialog>;
}
