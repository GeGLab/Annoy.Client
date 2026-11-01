import {PROFILE_FIELD_KINDS,normalizeProfileField,type ProfileField,type User} from "@distopic/protocol";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { type Account } from "../../store.ts";
import { Avatar, Icon } from "../ui.tsx";
import { Input } from "../ui/input.tsx";
import { Button } from "../ui/button.tsx";
import { Textarea } from "../ui/textarea.tsx";
import {Select} from "../ui/select.tsx";
import {Checkbox} from "../ui/checkbox.tsx";
import {useProfileDetails} from "../../features/profile/use-profile.ts";
import {PROFILE_LABELS,PROFILE_PLACEHOLDERS,AUDIENCE_LABELS,ProfileFieldIcon} from "../../features/profile/fields.tsx";
import {apiFor} from "../../client.ts";
import {toast} from "../../store.ts";
import {confirmAction} from "../ui/action-dialog.tsx";

const AvatarCropper = lazy(() => import("./AvatarCropper.tsx"));
export interface ProfileDraft {
  displayName: string;
  avatar?: Blob | null;
  bio?: string;
  details?: {fields:ProfileField[];historyEnabled:boolean};
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
  const profile=useProfileDetails(account.id,user.id);
  const details=draft.details??(profile.details?{fields:profile.details.fields,historyEnabled:profile.details.history.enabled}:null);
  const [deleting,setDeleting]=useState(false);
  const changeDetails=(next:NonNullable<ProfileDraft["details"]>)=>{
    const original=profile.details?{fields:profile.details.fields,historyEnabled:profile.details.history.enabled}:null;
    onChange({...draft,details:JSON.stringify(next)===JSON.stringify(original)?undefined:next});
  };
  const changeField=(kind:ProfileField["kind"],patch:Partial<ProfileField>)=>{
    if(!details)return;
    const old=details.fields.find(field=>field.kind===kind)??{kind,value:"",audience:"self" as const};
    changeDetails({...details,fields:[...details.fields.filter(field=>field.kind!==kind),{...old,...patch}]});
  };
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
    if (!/^image\/(png|jpeg|webp|gif)$/.test(photo.type) || photo.size > 8 * 1024 * 1024) {
      setError("Use uma foto PNG, JPEG, WebP ou GIF de até 8 MB.");
      return;
    }
    setError(null);
    original.current = photo;
    if (photo.type === "image/gif") { onChange({ ...draft, avatar: photo }); setFile(null); }
    else setFile(photo);
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
              <Button variant="ghost" size="sm" disabled={disabled || draft.avatar?.type === "image/gif"} onClick={() => void recrop()}>
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
        <p className="muted small">PNG, JPEG, WebP ou GIF · até 8 MB. GIFs mantêm a animação em repetição. A foto só é enviada ao salvar as alterações.</p>
        <input
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
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
        <section className="profile-privacy-editor"><h4>Redes e contatos</h4>
          <p className="muted small">Campos opcionais desta instância. Novos contatos ficam em Somente eu. E-mail e telefone não mudam suas credenciais ou a Conta Global.</p>
          {!profile.supported?<p className="muted small">Atualize o Annoy.Server e reconecte para editar contatos e privacidade.</p>:profile.loading&&!details?<p role="status">Carregando seus contatos…</p>:profile.error&&!details?<div role="alert"><p>{profile.error}</p><Button variant="secondary" onClick={profile.retry}>Tentar novamente</Button></div>:details&&<>
            {PROFILE_FIELD_KINDS.map(kind=>{
              const field=details.fields.find(item=>item.kind===kind);
              let validation="";try{normalizeProfileField(kind,field?.value??"");}catch(error){validation=(error as Error).message;}
              return <div className="profile-field-editor" key={kind}>
                <label className="field"><span className="field-label"><ProfileFieldIcon kind={kind}/>{PROFILE_LABELS[kind]}</span><Input aria-label={PROFILE_LABELS[kind]} value={field?.value??""} placeholder={PROFILE_PLACEHOLDERS[kind]} maxLength={2048} disabled={disabled||!profile.connected} aria-invalid={!!validation} onChange={event=>changeField(kind,{value:event.target.value})} onBlur={()=>{if(field?.value&&!validation)changeField(kind,{value:normalizeProfileField(kind,field.value)});}}/>{validation&&<span className="error small">{validation}</span>}{kind==="email"&&<span className="field-hint">Contato não verificado.</span>}{kind==="phone"&&<span className="field-hint">Formato internacional E.164, sem espaços.</span>}</label>
                <Select aria-label={`Quem pode ver ${PROFILE_LABELS[kind]}`} value={field?.audience??"self"} disabled={disabled||!profile.connected||!field?.value} onChange={event=>changeField(kind,{audience:event.target.value as ProfileField["audience"]})}>{Object.entries(AUDIENCE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select>
                <Button variant="ghost" size="sm" aria-label={`Remover ${PROFILE_LABELS[kind]}`} disabled={disabled||!field?.value} onClick={()=>changeDetails({...details,fields:details.fields.filter(item=>item.kind!==kind)})}><Icon name="trash" size={15}/></Button>
              </div>;
            })}
            <h4>Histórico de atividades</h4><label className="profile-history-consent"><Checkbox checked={details.historyEnabled} disabled={disabled||!profile.connected} onChange={event=>changeDetails({...details,historyEnabled:event.target.checked})}/>Guardar sessões de atividades nesta instância</label>
            <p className="muted small">Desligado inicialmente. Após salvar o consentimento, guarda até três sessões encerradas por até 30 dias, visíveis para você, amigos e membros de comunidades em comum. Desativar apaga o histórico. Arquivos, projetos e caminhos locais ficam fora do registro.</p>
            <Button variant="secondary" size="sm" disabled={disabled||deleting||!profile.connected} onClick={async()=>{
              if(!await confirmAction("Apagar o histórico de atividades? A exclusão é imediata e não será desfeita ao descartar as configurações."))return;
              setDeleting(true);try{await apiFor(account.id).del("/users/@me/activity-history");profile.retry();toast("Histórico apagado");}catch(error){toast((error as Error).message);}finally{setDeleting(false);}
            }}>{deleting?"Apagando…":"Apagar histórico salvo agora"}</Button>
          </>}
        </section>
      </div>
      <aside className="profile-live-preview" aria-label="Prévia do perfil">
        <h4>Como as pessoas veem você</h4>
        <div className="member-card member-profile profile-preview-card">
          <div className="member-card-head"><Avatar user={{ ...user, avatarUrl: preview, displayName: draft.displayName }} size={56} /><div><strong>{draft.displayName.trim() || user.displayName}</strong><div className="muted">@{user.username}</div></div></div>
          {(draft.bio ?? user.bio) && <p className="profile-bio" title={draft.bio ?? user.bio ?? ""}>{draft.bio ?? user.bio}</p>}
          {!!details?.fields.some(field=>field.value)&&<ul className="profile-contact-preview">{details.fields.filter(field=>field.value).map(field=><li key={field.kind}><ProfileFieldIcon kind={field.kind}/><div><strong>{PROFILE_LABELS[field.kind]}</strong><span>{field.value}</span><small>{AUDIENCE_LABELS[field.audience]}</small></div></li>)}</ul>}
        </div>
        <p className="muted small">A prévia acompanha suas alterações. As outras pessoas só as veem depois de salvar.</p>
      </aside>
      {file && (
        <Suspense fallback={<span role="status">Abrindo editor…</span>}>
          <AvatarCropper file={file} onClose={() => setFile(null)} onApply={(avatar) => onChange({ ...draft, avatar })} />
        </Suspense>
      )}
    </div>
  );
}
