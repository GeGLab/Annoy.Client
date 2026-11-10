import type { PinnedMessage } from "@annoy/protocol";

/** The cursor API orders pins by message ID, independently of when they were pinned. */
export function updateMessagePins(pins: PinnedMessage[], messageId: string, pin: PinnedMessage | null): PinnedMessage[] {
  const next = pins.filter(item => item.message.id !== messageId);
  if (pin) next.push(pin);
  return next.sort((a, b) => b.message.id.localeCompare(a.message.id)).slice(0, 100);
}
