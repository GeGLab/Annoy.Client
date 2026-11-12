import type { UserActivity } from "@annoy/protocol";
import { t as translate } from "../../../shared/localization/index.ts";
import { GameIcon } from "./activity/GameIcon.tsx";
import { openDmWith, sendDm } from "../social/dms.ts";
import type { DmMessage, GameInvite } from "../social/types.ts";
import { getState, toast, useStore } from "../store.ts";
import { Button } from "../components/ui/button.tsx";

/** The game this device sees running right now, if any. */
export function currentGame(activities: readonly UserActivity[] | undefined): UserActivity | undefined {
  return activities?.find((activity) => activity.kind === "game");
}

export function useCurrentGame(): UserActivity | undefined {
  return useStore((s) => currentGame(s.desktopActivity?.activities));
}

function inviteFrom(game: UserActivity): GameInvite {
  const appId = game.provider === "steam" && /^\d{1,10}$/.test(game.appId ?? "") ? game.appId : undefined;
  const artwork = game.artwork && /^https:\/\//.test(game.artwork) ? game.artwork : undefined;
  return { name: game.name, provider: game.provider, ...(appId && { appId }), ...(artwork && { artwork }), ...(game.startedAt && { startedAt: game.startedAt }) };
}

/** Sends "come play" for the game running now into a conversation (or opens one with a friend). */
export async function sendGameInvite(target: { conversationId: string } | { userId: string }): Promise<void> {
  const game = currentGame(getState().desktopActivity?.activities);
  if (!game) return void toast(translate("invite.noGame"));
  try {
    const conversationId = "conversationId" in target ? target.conversationId : (await openDmWith(target.userId)).id;
    const invite = inviteFrom(game);
    // The text is what clients without game invites show.
    await sendDm(conversationId, translate("invite.fallback", { p0: invite.name }), [], null, { invite });
    if ("userId" in target) toast(translate("invite.sent"));
  } catch (error) {
    toast((error as Error).message);
  }
}

/** Only Steam games can be started from a link; anything else stays informative. */
function launchUrl(invite: GameInvite): string | null {
  return invite.provider === "steam" && invite.appId ? `steam://rungameid/${invite.appId}` : null;
}

function since(startedAt: number | undefined): string | null {
  if (!startedAt) return null;
  const minutes = Math.max(0, Math.round((Date.now() - startedAt) / 60_000));
  return minutes < 60 ? translate("invite.forMinutes", { p0: minutes }) : translate("invite.forHours", { p0: Math.round(minutes / 60) });
}

/** The card a game invite renders as inside a conversation. */
export function GameInviteCard({ message, mine }: { message: DmMessage; mine: boolean }) {
  const invite = message.invite!;
  const url = launchUrl(invite);
  const activity: UserActivity = { kind: "game", provider: invite.provider as UserActivity["provider"], name: invite.name, ...(invite.appId && { appId: invite.appId }) };
  const details = [invite.provider === "steam" ? "Steam" : null, since(invite.startedAt)].filter(Boolean).join(" · ");
  return (
    <div className="game-invite" role="group" aria-label={translate("invite.title")}>
      <span className="game-invite-icon">{invite.appId ? <GameIcon activity={activity} size={34} /> : <span aria-hidden="true">{invite.name.slice(0, 2).toUpperCase()}</span>}</span>
      <span className="game-invite-copy">
        <strong>{translate("invite.title")}</strong>
        <span className="truncate">{invite.name}{details ? ` · ${details}` : ""}</span>
      </span>
      {!mine && (url
        ? <Button onClick={() => { window.open(url); }}>{translate("invite.join")}</Button>
        : <span className="muted small">{translate("invite.openYourself")}</span>)}
    </div>
  );
}
