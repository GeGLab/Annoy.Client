import type { User } from "@distopic/protocol";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { type Account } from "../../store.ts";
import { Avatar, Icon } from "../ui.tsx";
import { Input } from "../ui/input.tsx";
import { Button } from "../ui/button.tsx";
import { Textarea } from "../ui/textarea.tsx";

const AvatarCropper = lazy(() => import("./AvatarCropper.tsx"));
export interface ProfileDraft {
  displayName: string;
  avatar?: Blob | null;
  bio?: string;
}
export function ProfileEditor({
  account,
  user,
  draft,
  onChange,
  disabled,
}: {
  account: Account;
  user: User;
  draft: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const original = useRef<File | null>(null);
  const [preview, setPreview] = useState<string | null>(user.avatarUrl);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (draft.avatar instanceof Blob) {
      const url = URL.createObjectURL(draft.avatar);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview(draft.avatar === null ? null : user.avatarUrl);
  }, [draft.avatar, user.avatarUrl]);
  const pick = (photo: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(photo.type) || photo.size > 8 * 1024 * 1024) {
      setError("Use uma foto PNG, JPEG ou WebP de até 8 MB.");
      return;
    }
    setError(null);
    original.current = photo;
    setFile(photo);
  };
  const recrop = async () => {
    if (original.current) {
      setFile(original.current);
      return;
    }
    if (!user.avatarUrl) return;
    try {
      const response = await fetch(user.avatarUrl, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      pick(new File([blob], "perfil.webp", { type: blob.type }));
    } catch {
      setError("Não foi possível abrir a foto atual. Selecione o arquivo original para ajustar o recorte.");
    }
  };
  return (
    <div className="profile-editor">
      <div className="profile-preview">
        <Avatar user={{ ...user, avatarUrl: preview, displayName: draft.displayName }} size={84} />
        <span>Prévia do perfil</span>
        <div className="profile-mini-preview">
          <Avatar user={{ ...user, avatarUrl: preview, displayName: draft.displayName }} size={28} />
          <span>{draft.displayName || user.displayName}</span>
        </div>
      </div>
      <div className="profile-fields">
        <strong>{account.instanceName}</strong>
        <span className="muted small">
          @{user.username} · {account.url}
        </span>
        <label className="field">
          <span className="field-label">Nome de exibição</span>
          <Input
            aria-label={`Nome de exibição de ${user.username}`}
            value={draft.displayName}
            maxLength={32}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, displayName: event.target.value })}
          />
        </label>
        <label className="field"><span className="field-label">Biografia</span><Textarea aria-label={`Biografia de ${user.username}`} value={draft.bio ?? user.bio ?? ""} maxLength={1000} rows={4} disabled={disabled} placeholder="Conte um pouco sobre você…" onChange={(event) => onChange({ ...draft, bio: event.target.value })} /><span className="field-hint">{(draft.bio ?? user.bio ?? "").length}/1.000 · Aparece no seu perfil. A prévia ocupa até três linhas.</span></label>
        <div className="profile-actions">
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
            <Icon name="upload" size={15} />
            Alterar foto
          </Button>
          {preview && (
            <>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void recrop()}>
                <Icon name="crop" size={15} />
                Ajustar recorte
              </Button>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange({ ...draft, avatar: null })}>
                <Icon name="trash" size={15} />
                Remover foto
              </Button>
            </>
          )}
        </div>
        <p className="muted small">PNG, JPEG ou WebP · até 8 MB. A foto só é enviada ao salvar as alterações.</p>
        <input
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          ref={input}
          aria-label={`Selecionar foto de ${user.username}`}
          onChange={(event) => {
            if (event.target.files?.[0]) pick(event.target.files[0]);
            event.target.value = "";
          }}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      {file && (
        <Suspense fallback={<span role="status">Abrindo editor…</span>}>
          <AvatarCropper file={file} onClose={() => setFile(null)} onApply={(avatar) => onChange({ ...draft, avatar })} />
        </Suspense>
      )}
    </div>
  );
}
