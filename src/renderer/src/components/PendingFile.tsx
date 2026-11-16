import { t as translate } from "../../../shared/localization/index.ts";
import { useEffect, useState } from "react";
import { formatSize } from "../format.tsx";
import { Icon } from "./ui.tsx";

/** An attachment waiting in a composer (channels and DMs): a real preview for images, video and audio. */
export function PendingFile({ file, onRemove, disabled }: { file: File; onRemove: () => void; disabled: boolean }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const media = /^(image|video|audio)\//.test(file.type);
  useEffect(() => {
    if (!media) return;
    const source = URL.createObjectURL(file);
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file, media]);
  return (
    <div className="pending-file">
      {media && !failed ? (
        <div className="pending-preview">
          {file.type.startsWith("image/") ? <img src={url} alt={translate("chat.2cefb830f434",{p0:(file.name)})} onError={() => setFailed(true)} />
            : file.type.startsWith("video/") ? <video src={url} controls muted playsInline preload="metadata" aria-label={translate("chat.2cefb830f434",{p0:(file.name)})} onError={() => setFailed(true)} />
            : <><Icon name="music" size={24} /><audio src={url} controls preload="metadata" aria-label={translate("chat.2cefb830f434",{p0:(file.name)})} onError={() => setFailed(true)} /></>}
        </div>
      ) : <div className="pending-preview pending-preview-file"><Icon name="paperclip" size={24} /><span>{failed ? translate("chat.03d8e08e0311") : translate("chat.f9c6a1bb7ec8")}</span></div>}
      <div className="pending-file-details">
        <span className="truncate" title={file.name}>{file.name}</span>
        <span className="pending-file-size">{formatSize(file.size)}</span>
        <button className="icon-btn tiny" disabled={disabled} onClick={onRemove} aria-label={translate("expression.82e85db7347e",{p0:(file.name)})}><Icon name="x" size={14} /></button>
      </div>
    </div>
  );
}
