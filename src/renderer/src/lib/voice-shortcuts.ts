import { getState } from "../store.ts";
import { setPushToTalk } from "../client.ts";

/** Each call window forwards keys to the same microphone session. */
export function bindVoiceShortcuts(owner: Window): () => void {
  let pressed: string | null = null;
  const release = () => { if (pressed) { pressed = null; setPushToTalk(false); } };
  const down = (event: KeyboardEvent) => {
    const settings = getState().settings, target = event.target as HTMLElement | null;
    const editing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (settings.inputMode !== "ptt" || event.code !== settings.pttKey || editing) return;
    event.preventDefault();
    if (!pressed) { pressed = event.code; setPushToTalk(true); }
  };
  const up = (event: KeyboardEvent) => { if (event.code === pressed) release(); };
  owner.addEventListener("keydown", down);
  owner.addEventListener("keyup", up);
  owner.addEventListener("blur", release);
  return () => {
    release();
    owner.removeEventListener("keydown", down);
    owner.removeEventListener("keyup", up);
    owner.removeEventListener("blur", release);
  };
}
