import {t as translate} from "../../../../shared/localization/index.ts";
import { Slider } from "../ui/slider.tsx";
import Cropper, { type Area } from "react-easy-crop";
import { useEffect, useState, type CSSProperties } from "react";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog.tsx";
import { Button } from "../ui/button.tsx";

/** Draws the chosen area of `source` into a `width`×`height` WebP. */
export async function cropImage(source: string, area: Area, width: number, height: number): Promise<Blob> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(translate("settings.556c573b176f"));
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(translate("settings.d6dba62342f0")))), "image/webp", 0.9),
  );
}
export const cropAvatar = (source: string, area: Area) => cropImage(source, area, 512, 512);

export interface ImageCropperProps {
  file: File;
  /** Width / height of the result. */
  aspect: number;
  output: { width: number; height: number };
  title: string;
  description: string;
  note?: string;
  /** Rounds the highlighted area like the place the image is shown. */
  maskClassName?: string;
  /**
   * The part of the result that is visible wherever it is shown (fractions of
   * the crop, centred), drawn as a dashed guide inside the highlighted area.
   */
  safeArea?: { width: number; height: number };
  onApply: (blob: Blob) => void;
  onClose: () => void;
}

/** Drag and zoom to frame an image at a fixed proportion before it is uploaded. */
export function ImageCropper({ file, aspect, output, title, description, note, maskClassName, safeArea, onApply, onClose }: ImageCropperProps) {
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
      onApply(await cropImage(source, area, output.width, output.height));
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const stageStyle = safeArea ? ({ "--safe-w": safeArea.width, "--safe-h": safeArea.height } as CSSProperties) : undefined;
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className={`avatar-crop-dialog${aspect > 1.2 ? " wide-crop-dialog" : ""}`} showClose={false} aria-describedby="crop-description">
        <DialogTitle>{title}</DialogTitle>
        <p id="crop-description" className="muted">{description}</p>
        <div className="avatar-crop-stage" style={stageStyle}>
          {source && (
            <Cropper
              image={source}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              cropShape="rect"
              classes={{ cropAreaClassName: [maskClassName, safeArea ? "image-crop-safe" : ""].filter(Boolean).join(" ") }}
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
        {note && <p className="muted small">{note}</p>}
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

export default function AvatarCropper({ file, onApply, onClose }: { file: File; onApply: (blob: Blob) => void; onClose: () => void }) {
  return (
    <ImageCropper
      file={file}
      aspect={1}
      output={{ width: 512, height: 512 }}
      title={translate("settings.05ab2300e061")}
      description={translate("settings.0ae8f9f2f527")}
      note={translate("settings.34d353e6315d")}
      maskClassName="avatar-crop-mask"
      onApply={onApply}
      onClose={onClose}
    />
  );
}
