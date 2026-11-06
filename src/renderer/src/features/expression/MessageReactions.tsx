import { useEffect, useState } from "react";
import {t as translate,counted} from "../../../../shared/localization/index.ts";
import type { Message } from "@annoy/protocol";
import type { NameOf } from "../../format.tsx";
import { EmojiMenu } from "./MediaPicker.tsx";
import { isStickerLink, stickerName, StickerThumb } from "./AnnoySticker.tsx";

export const REACTION_SHORTCUTS = ["😂", "👍", "❤️"] as const;

/** A sticker reaction's name, read once the chip is drawn. */
function useStickerName(reaction: string, sticker: boolean): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(null);
    if (!sticker) return;
    let disposed = false;
    void stickerName(reaction).then((value) => { if (!disposed) setName(value); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [reaction, sticker]);
  return name;
}

function ReactionChip({ emoji, userIds, me, nameOf, disabled, onToggle }: { emoji: string; userIds: string[]; me: string; nameOf: NameOf; disabled: boolean; onToggle: (emoji: string) => void }) {
  const sticker = isStickerLink(emoji);
  const name = useStickerName(emoji, sticker);
  const selected = userIds.includes(me);
  const label = sticker ? name ?? translate("expression.stickerReactionName") : emoji;
  return <button className={`reaction${selected ? " selected" : ""}${sticker ? " sticker" : ""}`} aria-label={translate("common.07e3a63ea0ed",{p0:(label),p1:(counted(userIds.length,"counts.reaction.one","counts.reaction.other"))})} aria-pressed={selected} title={userIds.map((id) => id === me ? translate("expression.b21e91730d18") : nameOf(id) ?? translate("expression.f53bbaa05fae")).join(", ")} disabled={disabled} onClick={() => onToggle(emoji)}>
    {sticker ? <StickerThumb url={emoji} /> : <span aria-hidden="true">{emoji}</span>}<span className="reaction-count" aria-hidden="true">{userIds.length}</span>
  </button>;
}

export function ReactionChips({ reactions, me, nameOf, disabled, stickers, onToggle }: {
  reactions: NonNullable<Message["reactions"]>;
  me: string;
  nameOf: NameOf;
  disabled: boolean;
  /** The server accepts sticker links as reactions. */
  stickers: boolean;
  onToggle: (emoji: string) => void;
}) {
  if (!reactions.length) return null;
  return <div className="message-reactions" aria-label={translate("expression.b6ea01c01618")}>
    {reactions.map(({ emoji, userIds }) => <ReactionChip key={emoji} emoji={emoji} userIds={userIds} me={me} nameOf={nameOf} disabled={disabled} onToggle={onToggle} />)}
    {!disabled && <EmojiMenu stickers={stickers} onSelect={onToggle} />}
  </div>;
}
