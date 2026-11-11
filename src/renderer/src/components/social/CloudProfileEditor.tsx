import { useEffect, useRef, useState } from "react";
import { t as translate } from "../../../../shared/localization/index.ts";
import { toast, useStore } from "../../store.ts";
import { updateProfile, uploadProfileImage } from "../../social/index.ts";
import { deleteCloudHistory, readCloudDetails, saveCloudDetails, type CloudProfileDetails } from "../../social/details.ts";
import { ProfileDetailsSection } from "../settings/ProfileEditor.tsx";
import type { ServerVisibility } from "../../social/types.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { Avatar } from "../ui.tsx";
import { cloudUser } from "../../social/profile.ts";

/**
 * The Annoy account's public profile (usersannoy): the one profile. Friends and
 * DMs read it; social/profile-sync.ts copies name, bio and photo to each server
 * signed in with the Annoy account.
 */
export function CloudProfileEditor() {
  const me = useStore((s) => s.social.me);
  const ready = useStore((s) => s.social.status === "ready");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [visibility, setVisibility] = useState<ServerVisibility>("shared");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  // Profile contacts and activity history: also part of the Annoy account.
  const revision = useStore((s) => s.social.detailsRevision);
  const [stored, setStored] = useState<CloudProfileDetails | null>(null);
  const [detailsError, setDetailsError] = useState<string | undefined>();
  const [detailsAttempt, setDetailsAttempt] = useState(0);
  const [draftDetails, setDraftDetails] = useState<{ fields: CloudProfileDetails["fields"]; historyEnabled: boolean } | undefined>();
  useEffect(() => {
    if (!me || !ready) return;
    const controller = new AbortController();
    setDetailsError(undefined);
    void readCloudDetails(me.id, controller.signal).then((value) => { if (!controller.signal.aborted) setStored(value); })
      .catch((error) => { if (!controller.signal.aborted) setDetailsError((error as Error).message); });
    return () => controller.abort();
  }, [me?.id, ready, revision, detailsAttempt]);
  const original = stored ? { fields: stored.fields, historyEnabled: stored.history.enabled } : null;
  const details = draftDetails ?? original;
  useEffect(() => {
    if (!me) return;
    setName(me.displayName ?? "");
    setBio(me.bio ?? "");
    setVisibility(me.serverVisibility);
  }, [me?.id, me?.displayName, me?.bio, me?.serverVisibility]);
  if (!me) return null;
  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await action();
      if (done) toast(done);
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const profileDirty = name.trim() !== (me.displayName ?? "") || bio.trim() !== (me.bio ?? "") || visibility !== me.serverVisibility;
  const dirty = profileDirty || !!draftDetails;
  const save = async () => {
    if (profileDirty) await updateProfile({ displayName: name.trim() || null, bio: bio.trim() || null, serverVisibility: visibility });
    if (draftDetails) { setStored(await saveCloudDetails(draftDetails)); setDraftDetails(undefined); }
  };
  return (
    <div className="cloud-profile">
      <h4>{translate("social.profileTitle")}</h4>
      <p className="muted small">{translate("social.profileHelp")}</p>
      <div className="cloud-profile-head">
        <Avatar user={cloudUser(me)} size={64} />
        <div className="cloud-profile-avatar-actions">
          <Button size="sm" variant="secondary" disabled={!ready || busy} onClick={() => file.current?.click()}>
            {translate("social.changeAvatar")}
          </Button>
          {me.avatar && (
            <Button size="sm" variant="ghost" disabled={!ready || busy} onClick={() => void run(() => updateProfile({ avatar: null }))}>
              {translate("social.removeAvatar")}
            </Button>
          )}
          <small className="muted">{translate("social.yourId", { p0: me.id })}</small>
        </div>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            if (picked) void run(async () => updateProfile({ avatar: await uploadProfileImage(picked, "avatar") }));
          }}
        />
      </div>
      <label className="field">
        <span>{translate("social.displayName")}</span>
        <Input value={name} maxLength={32} placeholder={me.username} disabled={busy} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>{translate("social.bio")}</span>
        <Textarea value={bio} maxLength={190} rows={3} disabled={busy} onChange={(e) => setBio(e.target.value)} />
      </label>
      <fieldset className="field">
        <legend>{translate("social.serverVisibility")}</legend>
        {(["shared", "friends", "public"] as const).map((v) => (
          <label key={v} className="radio-row">
            <input type="radio" name="server-visibility" checked={visibility === v} disabled={busy} onChange={() => setVisibility(v)} />
            <span>{v === "shared" ? translate("social.visibilityShared") : v === "friends" ? translate("social.visibilityFriends") : translate("social.visibilityPublic")}</span>
          </label>
        ))}
        <small className="muted">{translate("social.visibilityHelp")}</small>
      </fieldset>
      <ProfileDetailsSection
        profile={{ supported: true, connected: ready, loading: !stored && !detailsError, error: detailsError, details: stored ?? undefined, retry: () => setDetailsAttempt((v) => v + 1) }}
        details={details}
        disabled={busy}
        intro={translate("social.contactsHelp")}
        onChange={(next) => setDraftDetails(JSON.stringify(next) === JSON.stringify(original) ? undefined : next)}
        onDeleteHistory={deleteCloudHistory}
        annoy
      />
      <Button disabled={!ready || busy || !dirty} loading={busy} onClick={() => void run(save, translate("social.saved"))}>
        {translate("social.save")}
      </Button>
    </div>
  );
}
