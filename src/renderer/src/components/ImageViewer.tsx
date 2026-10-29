import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { formatSize } from "../format.tsx";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Button } from "./ui/button.tsx";
import { Icon } from "./ui.tsx";

export interface ViewerImage { id: string; url: string; filename: string; size: number }

/** Loaded only when an attachment is opened; no image data is copied into global state. */
export default function ImageViewer({ images, initialIndex, onClose }: { images: ViewerImage[]; initialIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const current = images[index]!;
  const move = (step: number) => {
    setIndex(i => Math.max(0, Math.min(images.length - 1, i + step)));
    setZoom(1); setNatural({ width: 0, height: 0 }); setFailed(false);
  };
  useEffect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => entry && setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport]);
  const fit = natural.width && bounds.width && bounds.height ? Math.max(.01, Math.min(1, (bounds.width - 48) / natural.width, (bounds.height - 48) / natural.height)) : 1;
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
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent className="image-viewer" showClose={false} aria-describedby={undefined} onKeyDown={event => {
    if (event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowRight" && index < images.length - 1) { event.preventDefault(); move(1); }
    if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); move(-1); }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); setZoom(z => Math.min(4, z + .5)); }
    if (event.key === "-") { event.preventDefault(); setZoom(z => Math.max(1, z - .5)); }
  }}>
    <header className="viewer-header"><span className="viewer-file-icon"><Icon name="image" size={22} /></span><div className="viewer-file-info"><DialogTitle className="truncate">{current.filename}</DialogTitle><span className="muted small">{formatSize(current.size)}{natural.width > 0 && ` · ${natural.width} × ${natural.height}`}</span></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar visualizador"><Icon name="x" /></Button></header>
    <div className="viewer-viewport" ref={setViewport}>
      {loading && <div className="viewer-status" role="status"><Icon name="loader" size={24} /><span>Carregando imagem…</span></div>}
      {failed ? <div className="viewer-status" role="alert"><Icon name="image" size={40} /><h2>Não foi possível carregar a imagem</h2><p className="muted">Verifique sua conexão e tente novamente.</p><Button variant="secondary" onClick={() => { setFailed(false); setAttempt(a => a + 1); }}>Tentar novamente</Button></div> : <m.div className="viewer-canvas" initial={{ opacity: .65 }} animate={{ opacity: 1 }} transition={{ duration: .18 }} key={current.id}>
        <img key={`${current.id}-${attempt}`} src={current.url} alt={current.filename} draggable={false} onLoad={e => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} onError={() => setFailed(true)} style={natural.width ? { width: Math.max(1, natural.width * fit * zoom), height: Math.max(1, natural.height * fit * zoom) } : { visibility: "hidden" }} />
      </m.div>}
    </div>
    <footer className="viewer-footer"><span className="viewer-count" aria-live="polite">{index + 1} de {images.length}</span><div className="viewer-tools">
      {images.length > 1 && <><Button variant="ghost" size="icon" disabled={index === 0} onClick={() => move(-1)} aria-label="Imagem anterior"><Icon name="left" /></Button><Button variant="ghost" size="icon" disabled={index === images.length - 1} onClick={() => move(1)} aria-label="Próxima imagem"><Icon name="right" /></Button><span className="viewer-tool-divider" /></>}
      <Button variant="ghost" size="icon" disabled={zoom <= 1 || loading || failed} onClick={() => setZoom(z => Math.max(1, z - .5))} aria-label="Diminuir imagem"><Icon name="zoomOut" /></Button><Button variant="ghost" className="viewer-zoom" disabled={loading || failed} onClick={() => setZoom(1)} aria-label="Ajustar imagem à janela">{Math.round(zoom * 100)}%</Button><Button variant="ghost" size="icon" disabled={zoom >= 4 || loading || failed} onClick={() => setZoom(z => Math.min(4, z + .5))} aria-label="Ampliar imagem"><Icon name="zoomIn" /></Button>
    </div><a className="viewer-original" href={current.url} target="_blank" rel="noreferrer">Abrir original <Icon name="external" size={14} /></a></footer>
  </DialogContent></Dialog>;
}
