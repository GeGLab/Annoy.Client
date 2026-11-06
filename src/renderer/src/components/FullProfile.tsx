import {localizationPreferences} from "../../../shared/localization/index.ts";
import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import type { User } from "@annoy/protocol";
import { useState } from "react";
import { useStore, EMPTY_ACTIVITIES } from "../store.ts";
import { canViewActivity } from "../features/activity/access.ts";
import { ActivityStack } from "../features/activity/ActivityCard.tsx";
import { useProfileDetails } from "../features/profile/use-profile.ts";
import {
  PROFILE_LABELS,
  ProfileFieldIcon,
} from "../features/profile/fields.tsx";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "./ui/dialog.tsx";
import { Button } from "./ui/button.tsx";
import { Avatar, Icon } from "./ui.tsx";

export function FullProfileButton({
  accountId,
  user,
}: {
  accountId: string;
  user: User;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">{rich("common.91debd26f145",{p0:(<Icon name="users" size={16} />)})}</Button>
      </DialogTrigger>
      {open && <FullProfile accountId={accountId} user={user} />}
    </Dialog>
  );
}
function FullProfile({ accountId, user }: { accountId: string; user: User }) {
  const { details, error, unavailable, loading, supported, connected, retry } =
    useProfileDetails(accountId, user.id);
  const instance = useStore((s) => s.instances[accountId]);
  const presence = instance?.presences[user.id] ?? "offline";
  const relationship = instance?.relationships.find(
    (item) => item.user.id === user.id,
  );
  const activities = canViewActivity(instance, user.id)
    ? (instance?.activities[user.id] ?? EMPTY_ACTIVITIES)
    : EMPTY_ACTIVITIES;
  const identity = details?.user ?? user;
  return (
    <DialogContent
      className="modal full-profile"
      overlayClassName="full-profile-overlay"
    >
      <DialogTitle className="full-profile-title">{rich("common.bb51fa235d84",{p0:(relationship?.nickname || identity.displayName)})}</DialogTitle>
      <DialogDescription className="muted small">{translate("common.ba7fca20614f")}</DialogDescription>
      <div className="full-profile-identity">
        <Avatar user={identity} presence={presence} size={72} />
        <div>
          <h2>{relationship?.nickname || identity.displayName}</h2>
          <p className="muted">@{identity.username}</p>
          <span>
            {presence === "online"
              ? translate("common.0d21bd52022c")
              : presence === "idle"
                ? translate("common.fd7f0836e8ad")
                : presence === "dnd"
                  ? translate("common.976685dd88bf")
                  : translate("common.a1794783aab7")}
          </span>
        </div>
      </div>
      {identity.bio && (
        <section>
          <h3>{translate("common.4cadb7f9efaa")}</h3>
          <p className="full-profile-bio">{identity.bio}</p>
        </section>
      )}
      {activities.length > 0 && (
        <section>
          <h3>{translate("common.60e8f5cb5d84")}</h3>
          <ActivityStack activities={activities} />
        </section>
      )}
      {!connected ? (
        <p role="status">{translate("common.56732ab52c86")}</p>
      ) : !supported ? (
        <p role="status">{translate("common.e2e3ff4c83da")}</p>
      ) : loading ? (
        <p role="status">{translate("common.bff791e5857b")}</p>
      ) : unavailable ? (
        <p role="status">{translate("common.665820c474ff")}</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <Button variant="secondary" onClick={retry}>{translate("common.b9e10688be01")}</Button>
        </div>
      ) : (
        details && (
          <>
            <section>
              <h3>{translate("common.547c01840a7c")}</h3>
              {details.fields.length > 0 ? (
                <ul className="profile-contact-list">
                  {details.fields.map((field) => (
                    <li key={field.kind}>
                      <ProfileFieldIcon kind={field.kind} />
                      <div>
                        <strong>{PROFILE_LABELS[field.kind]}</strong>
                        {["email", "phone"].includes(field.kind) ? (
                          <span>
                            {field.value}
                            {field.kind === "email" && (
                              <small className="muted">{translate("common.1ec451c7a3ae")}</small>
                            )}
                          </span>
                        ) : (
                          <a
                            href={field.value}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {field.value}
                            <Icon name="external" size={13} />
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  {details.hasPrivateFields
                    ? translate("common.d116552ef4a2")
                    : translate("common.7bcba8a97e24")}
                </p>
              )}
              {details.hasPrivateFields && details.fields.length > 0 && (
                <p className="muted small">{translate("common.a887eaea4bd8")}</p>
              )}
            </section>
            <section>
              <h3>{translate("common.83549f764bc9")}</h3>
              {details.history.visibility === "disabled" ? (
                <p className="muted">{translate("common.de467c13fba1")}</p>
              ) : details.history.visibility === "private" ? (
                <p className="muted">{translate("common.283b77b659d0")}</p>
              ) : details.history.entries.length === 0 ? (
                <p className="muted">{translate("common.72531dedf740")}</p>
              ) : (
                <ol className="activity-history-list">
                  {details.history.entries.map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.name}</strong>
                      <span className="muted">
                        {new Date(entry.startedAt).toLocaleString(localizationPreferences().region,{...({hourCycle:localizationPreferences().hourCycle}),hourCycle:localizationPreferences().hourCycle})} ·{" "}
                        {entry.endedAt
                          ? translate("common.c4e0a84b834b",{p0:(Math.max(0, Math.floor((Date.parse(entry.endedAt) - Date.parse(entry.startedAt)) / 60_000)))})
                          : translate("common.9b57f20158cc")}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="muted small">{translate("common.b48ab29de390")}</p>
            </section>
          </>
        )
      )}
    </DialogContent>
  );
}




