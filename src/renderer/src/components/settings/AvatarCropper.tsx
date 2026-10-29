import { Slider } from "../ui/slider.tsx";
import Cropper, { type Area } from "react-easy-crop";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog.tsx";
import { Button } from "../ui/button.tsx";

export async function cropAvatar(source: string, area: Area): Promise<Blob> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar a foto.");
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, 512, 512);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível recortar a foto."))), "image/webp", 0.9),
  );
}
export default function AvatarCropper({ file, onApply, onClose }: { file: File; onApply: (blob: Blob) => void; onClose: () => void }) {
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const apply = async () => {
    if (!source || !area || busy) return;
    setBusy(true);
    try {
      onApply(await cropAvatar(source, area));
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="avatar-crop-dialog" showClose={false} aria-describedby="crop-description">
        <DialogTitle>Encontre o melhor enquadramento</DialogTitle>
        <p id="crop-description" className="muted">
          Arraste a foto e ajuste o zoom. A área destacada é o que aparece no seu perfil.
        </p>
        <div className="avatar-crop-stage">
          {source && (
            <Cropper
              image={source}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="rect"
              classes={{ cropAreaClassName: "avatar-crop-mask" }}
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
              mediaProps={{ onError: () => setError("Esta imagem não pôde ser aberta.") }}
            />
          )}
        </div>
        <label className="field">
          <span>Zoom da foto</span>
          <Slider
            aria-label="Zoom da foto"

            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <p className="muted small">O recorte quadrado também é preservado para os avatares com cantos arredondados do Annoy.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!area || !!error} onClick={() => void apply()}>
            Usar este recorte
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
