import {t as translate,counted} from "../../../../shared/localization/index.ts";
import type { Message } from "@annoy/protocol";
import type { NameOf } from "../../format.tsx";
import { EmojiMenu } from "./MediaPicker.tsx";

export const REACTION_SHORTCUTS = ["😂", "👍", "❤️"] as const;

export function ReactionChips({ reactions, me, nameOf, disabled, onToggle }: {
  reactions: NonNullable<Message["reactions"]>;
  me: string;
  nameOf: NameOf;
  disabled: boolean;
  onToggle: (emoji: string) => void;
}) {
  if (!reactions.length) return null;
  return <div className="message-reactions" aria-label={translate("expression.b6ea01c01618")}>
    {reactions.map(({ emoji, userIds }) => {
      const selected = userIds.includes(me);
      return <button key={emoji} className={`reaction${selected ? " selected" : ""}`} aria-label={translate("common.07e3a63ea0ed",{p0:(emoji),p1:(counted(userIds.length,"counts.reaction.one","counts.reaction.other"))})} aria-pressed={selected} title={userIds.map((id) => id === me ? translate("expression.b21e91730d18") : nameOf(id) ?? translate("expression.f53bbaa05fae")).join(", ")} disabled={disabled} onClick={() => onToggle(emoji)}>
        <span aria-hidden="true">{emoji}</span><span className="reaction-count" aria-hidden="true">{userIds.length}</span>
      </button>;
    })}
    {!disabled && <EmojiMenu onSelect={onToggle} />}
  </div>;
}




