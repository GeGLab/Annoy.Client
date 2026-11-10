import { t as translate } from "../../../shared/localization/index.ts";
import { isStickerMessage } from "../features/expression/AnnoySticker.tsx";
import { previewText, type NameOf } from "../format.tsx";
import { Icon } from "./ui/icon.tsx";

export function ReplyPreview({ author, content, attachmentNames, nameOf, channelOf, onCancel }: {
  author: string;
  content: string;
  attachmentNames: string[];
  nameOf: NameOf;
  channelOf?: NameOf;
  onCancel: () => void;
}) {
  const sticker = isStickerMessage(content);
  const excerpt = sticker ? translate("chat.replySticker")
    : previewText(content, nameOf, channelOf) || attachmentNames.join(", ") || translate("common.e186297c35aa");
  return (
    <div className="reply-bar reply-preview">
      <Icon name="reply" size={16} />
      <div className="reply-preview-text">
        <span className="reply-preview-author truncate">{translate("social.replyingTo", { p0: author })}</span>
        <span className="reply-preview-excerpt truncate" title={excerpt}>
          {(sticker || !content.trim()) && <Icon name={sticker ? "image" : "paperclip"} size={13} />}
          {excerpt}
        </span>
      </div>
      <button type="button" className="icon-btn tiny" aria-label={translate("chat.c0ec9adf7f1d")} title={translate("chat.c0ec9adf7f1d")} onClick={onCancel}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
