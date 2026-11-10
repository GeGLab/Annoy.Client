import { createPortal } from "react-dom";
import { useStore } from "../store.ts";
import { useCallWindow } from "../features/call-window.ts";
import { VoiceStage } from "./VoiceStage.tsx";

/** The original renderer owns the call and media; only its view moves to the child. */
export function CallWindow() {
  const child = useCallWindow();
  const voice = useStore(s => s.voice);
  const state = useStore(s => s.voice ? s.instances[s.voice.accountId]?.serverStates[s.voice.serverId] : undefined);
  const toast = useStore(s => s.toast);
  const channel = state?.channels.find(item => item.id === voice?.channelId);
  if (!child || child.closed || !voice || !state || !channel) return null;
  const root = child.document.getElementById("call-window-root");
  return root ? createPortal(<><VoiceStage accountId={voice.accountId} state={state} channel={channel} detached />{toast && <div className="toast" role="status">{toast.text}</div>}</>, root) : null;
}
