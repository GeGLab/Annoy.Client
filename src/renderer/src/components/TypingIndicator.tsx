/** "X is typing": three dots that bounce in turn, then the sentence. Motion stops for reduced-motion users. */
export function TypingIndicator({ text }: { text: string }) {
  return (
    <span className="typing-indicator">
      <span className="typing-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="typing-text">{text}</span>
    </span>
  );
}
