import {rich} from "../../lib/localization.ts";
import {t as translate} from "../../../../shared/localization/index.ts";
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
      setError(translate("settings.a6d45f4a8661"));
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
      setError(translate("settings.9666f56d98a7"));
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
          <span className="field-label">{translate("common.80d20f1ebbc0")}</span>
          <Input
            aria-label={translate("settings.6a44cc7b2a5c",{p0:(user.username)})}
            value={draft.displayName}
            maxLength={32}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, displayName: event.target.value })}
          />
        </label>
        <label className="field"><span className="field-label">{translate("settings.b14f559be424")}</span><Textarea aria-label={translate("settings.b05eec51338a",{p0:(user.username)})} value={draft.bio ?? user.bio ?? ""} maxLength={1000} rows={4} disabled={disabled} placeholder={translate("settings.d7599fd431c5")} onChange={(event) => onChange({ ...draft, bio: event.target.value })} /><span className="field-hint">{rich("common.bd1c531633d3",{p0:((draft.bio ?? user.bio ?? "").length)})}</span></label>
        <div className="profile-actions">
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => input.current?.click()}>{rich("common.a7bede7763b9",{p0:(<Icon name="upload" size={15} />)})}</Button>
          {preview && (
            <>
              <Button variant="ghost" size="sm" disabled={disabled || draft.avatar?.type === "image/gif"} onClick={() => void recrop()}>{rich("common.a3a3d1eeeba5",{p0:(<Icon name="crop" size={15} />)})}</Button>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange({ ...draft, avatar: null })}>{rich("common.556864f4562f",{p0:(<Icon name="trash" size={15} />)})}</Button>
            </>
          )}
        </div>
        <p className="muted small">{translate("settings.9cc3a992124f")}</p>
        <input
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          ref={input}
          aria-label={translate("settings.5d931a5ba01b",{p0:(user.username)})}
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
        <section className="profile-privacy-editor"><h4>{translate("common.547c01840a7c")}</h4>
          <p className="muted small">{translate("settings.7d3050d20d4b")}</p>
          {!profile.supported?<p className="muted small">{translate("settings.d06344b0b31c")}</p>:profile.loading&&!details?<p role="status">{translate("settings.dc5ddb06911f")}</p>:profile.error&&!details?<div role="alert"><p>{profile.error}</p><Button variant="secondary" onClick={profile.retry}>{translate("common.b9e10688be01")}</Button></div>:details&&<>
            {PROFILE_FIELD_KINDS.map(kind=>{
              const field=details.fields.find(item=>item.kind===kind);
              let validation="";try{normalizeProfileField(kind,field?.value??"");}catch(error){validation=(error as Error).message;}
              return <div className="profile-field-editor" key={kind}>
                <label className="field"><span className="field-label"><ProfileFieldIcon kind={kind}/>{PROFILE_LABELS[kind]}</span><Input aria-label={PROFILE_LABELS[kind]} value={field?.value??""} placeholder={PROFILE_PLACEHOLDERS[kind]} maxLength={2048} disabled={disabled||!profile.connected} aria-invalid={!!validation} onChange={event=>changeField(kind,{value:event.target.value})} onBlur={()=>{if(field?.value&&!validation)changeField(kind,{value:normalizeProfileField(kind,field.value)});}}/>{validation&&<span className="error small">{validation}</span>}{kind==="email"&&<span className="field-hint">{translate("settings.a003af875e0d")}</span>}{kind==="phone"&&<span className="field-hint">{translate("settings.fcd094aacecc")}</span>}</label>
                <Select aria-label={translate("settings.2e0b86907bf6",{p0:(PROFILE_LABELS[kind])})} value={field?.audience??"self"} disabled={disabled||!profile.connected||!field?.value} onChange={event=>changeField(kind,{audience:event.target.value as ProfileField["audience"]})}>{Object.entries(AUDIENCE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select>
                <Button variant="ghost" size="sm" aria-label={translate("expression.82e85db7347e",{p0:(PROFILE_LABELS[kind])})} disabled={disabled||!field?.value} onClick={()=>changeDetails({...details,fields:details.fields.filter(item=>item.kind!==kind)})}><Icon name="trash" size={15}/></Button>
              </div>;
            })}
            <h4>{translate("common.83549f764bc9")}</h4><label className="profile-history-consent"><Checkbox checked={details.historyEnabled} disabled={disabled||!profile.connected} onChange={event=>changeDetails({...details,historyEnabled:event.target.checked})}/>{translate("settings.1a0d092c2e83")}</label>
            <p className="muted small">{translate("settings.b67c6b8ade75")}</p>
            <Button variant="secondary" size="sm" disabled={disabled||deleting||!profile.connected} onClick={async()=>{
              if(!await confirmAction(translate("settings.a98a312a03c8")))return;
              setDeleting(true);try{await apiFor(account.id).del("/users/@me/activity-history");profile.retry();toast(translate("settings.46d1a7cbaa39"));}catch(error){toast((error as Error).message);}finally{setDeleting(false);}
            }}>{deleting?"Apagando…":translate("settings.84abdb96ed02")}</Button>
          </>}
        </section>
      </div>
      <aside className="profile-live-preview" aria-label={translate("settings.8a9623359659")}>
        <h4>{translate("settings.e6f37ed76e87")}</h4>
        <div className="member-card member-profile profile-preview-card">
          <div className="member-card-head"><Avatar user={{ ...user, avatarUrl: preview, displayName: draft.displayName }} size={56} /><div><strong>{draft.displayName.trim() || user.displayName}</strong><div className="muted">@{user.username}</div></div></div>
          {(draft.bio ?? user.bio) && <p className="profile-bio" title={draft.bio ?? user.bio ?? ""}>{draft.bio ?? user.bio}</p>}
          {!!details?.fields.some(field=>field.value)&&<ul className="profile-contact-preview">{details.fields.filter(field=>field.value).map(field=><li key={field.kind}><ProfileFieldIcon kind={field.kind}/><div><strong>{PROFILE_LABELS[field.kind]}</strong><span>{field.value}</span><small>{AUDIENCE_LABELS[field.audience]}</small></div></li>)}</ul>}
        </div>
        <p className="muted small">{translate("settings.0faf65a2a34c")}</p>
      </aside>
      {file && (
        <Suspense fallback={<span role="status">{translate("settings.d6575f4e8b75")}</span>}>
          <AvatarCropper file={file} onClose={() => setFile(null)} onApply={(avatar) => onChange({ ...draft, avatar })} />
        </Suspense>
      )}
    </div>
  );
}


