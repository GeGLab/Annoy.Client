import {t as translate} from "../../../../shared/localization/index.ts";
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
  if (!context) throw new Error(translate("settings.556c573b176f"));
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, 512, 512);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(translate("settings.d6dba62342f0")))), "image/webp", 0.9),
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
        <DialogTitle>{translate("settings.05ab2300e061")}</DialogTitle>
        <p id="crop-description" className="muted">{translate("settings.0ae8f9f2f527")}</p>
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
              mediaProps={{ onError: () => setError(translate("settings.bbc2362ddf99")) }}
            />
          )}
        </div>
        <label className="field">
          <span>{translate("settings.ecfce5342c3b")}</span>
          <Slider
            aria-label={translate("settings.ecfce5342c3b")}

            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <p className="muted small">{translate("settings.34d353e6315d")}</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button variant="secondary" disabled={busy} onClick={onClose}>{translate("common.bb9dbb406dcb")}</Button>
          <Button loading={busy} disabled={!area || !!error} onClick={() => void apply()}>{translate("settings.66ad416065d5")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


