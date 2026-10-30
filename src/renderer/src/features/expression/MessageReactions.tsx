import type { Message } from "@distopic/protocol";
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
  return <div className="message-reactions" aria-label="Reações à mensagem">
    {reactions.map(({ emoji, userIds }) => {
      const selected = userIds.includes(me);
      return <button key={emoji} className={`reaction${selected ? " selected" : ""}`} aria-label={`${emoji}: ${userIds.length} ${userIds.length === 1 ? "reação" : "reações"}`} aria-pressed={selected} title={userIds.map((id) => id === me ? "Você" : nameOf(id) ?? "Usuário").join(", ")} disabled={disabled} onClick={() => onToggle(emoji)}>
        <span aria-hidden="true">{emoji}</span><span className="reaction-count" aria-hidden="true">{userIds.length}</span>
      </button>;
    })}
    {!disabled && <EmojiMenu onSelect={onToggle} />}
  </div>;
}
