export interface ChatDraft {
  text: string;
  replyToId: string | null;
  /** Count only; browser File objects never leave this process memory. */
  attachmentCount: number;
  updatedAt: number;
}

export interface ChatAnchor {
  messageId: string;
  /** Top edge of the message relative to the scroll viewport, in CSS pixels. */
  offset: number;
}

export type RecoveryReturn =
  | { kind: "home"; dmId: string | null }
  | { kind: "server"; serverId: string; channelId: string | null }
  | { kind: "marketplace"; serverId: string | null };

interface ChatStateDocument {
  version: 1;
  drafts: Record<string, ChatDraft>;
  anchors: Record<string, ChatAnchor>;
  recoveryReturns: Record<string, RecoveryReturn>;
}

const STORAGE_KEY = "distopic.chat-state.v1";
const filesByChannel = new Map<string, File[]>();
const pendingAnchorTimers = new Map<string, ReturnType<typeof setTimeout>>();
const channelKey = (accountId: string, channelId: string) => JSON.stringify([accountId, channelId]);

function emptyDocument(): ChatStateDocument { return { version: 1, drafts: {}, anchors: {}, recoveryReturns: {} }; }

function loadDocument(): ChatStateDocument {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDocument();
    const parsed = JSON.parse(raw) as Partial<ChatStateDocument>;
    if (parsed.version !== 1 || !parsed.drafts || !parsed.anchors) return emptyDocument();
    return { version: 1, drafts: parsed.drafts, anchors: parsed.anchors, recoveryReturns: parsed.recoveryReturns ?? {} };
  } catch {
    return emptyDocument();
  }
}

let documentState = loadDocument();

function flush(): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(documentState));
    return true;
  } catch {
    return false;
  }
}

export function draftKey(accountId: string, channelId: string): string {
  return channelKey(accountId, channelId);
}

export function readChatDraft(accountId: string, channelId: string): ChatDraft {
  const saved = documentState.drafts[channelKey(accountId, channelId)];
  return saved ? { ...saved } : { text: "", replyToId: null, attachmentCount: 0, updatedAt: 0 };
}

export function writeChatDraft(accountId: string, channelId: string, value: Pick<ChatDraft, "text" | "replyToId" | "attachmentCount">): boolean {
  const key = channelKey(accountId, channelId);
  if (!value.text && !value.replyToId && value.attachmentCount <= 0) delete documentState.drafts[key];
  else documentState.drafts[key] = { ...value, updatedAt: Date.now() };
  return flush();
}

export function clearChatDraft(accountId: string, channelId: string): void {
  const key = channelKey(accountId, channelId);
  delete documentState.drafts[key];
  filesByChannel.delete(key);
  flush();
}

export function readPendingFiles(accountId: string, channelId: string): File[] {
  return [...(filesByChannel.get(channelKey(accountId, channelId)) ?? [])];
}

export function writePendingFiles(accountId: string, channelId: string, files: File[]): boolean {
  const key = channelKey(accountId, channelId);
  if (files.length) filesByChannel.set(key, [...files]);
  else filesByChannel.delete(key);
  const draft = readChatDraft(accountId, channelId);
  return writeChatDraft(accountId, channelId, { ...draft, attachmentCount: files.length });
}

export function readChatAnchor(accountId: string, channelId: string): ChatAnchor | null {
  const anchor = documentState.anchors[channelKey(accountId, channelId)];
  return anchor ? { ...anchor } : null;
}

export function writeChatAnchor(accountId: string, channelId: string, anchor: ChatAnchor): void {
  const key = channelKey(accountId, channelId);
  documentState.anchors[key] = { messageId: anchor.messageId, offset: Math.round(anchor.offset * 100) / 100 };
  const oldTimer = pendingAnchorTimers.get(key);
  if (oldTimer) clearTimeout(oldTimer);
  pendingAnchorTimers.set(key, setTimeout(() => {
    pendingAnchorTimers.delete(key);
    flush();
  }, 180));
}

export function clearChatAnchor(accountId: string, channelId: string): void {
  const key = channelKey(accountId, channelId);
  const timer = pendingAnchorTimers.get(key);
  if (timer) clearTimeout(timer);
  pendingAnchorTimers.delete(key);
  delete documentState.anchors[key];
  flush();
}

export function flushChatState(): void {
  for (const timer of pendingAnchorTimers.values()) clearTimeout(timer);
  pendingAnchorTimers.clear();
  flush();
}

export function clearAccountChatState(accountId: string): void {
  const removeOwned = (key: string) => {
    try { return JSON.parse(key)[0] === accountId; }
    catch { return false; }
  };
  for (const key of Object.keys(documentState.drafts)) if (removeOwned(key)) delete documentState.drafts[key];
  for (const key of Object.keys(documentState.anchors)) if (removeOwned(key)) delete documentState.anchors[key];
  for (const key of filesByChannel.keys()) if (removeOwned(key)) filesByChannel.delete(key);
  for (const [key, timer] of pendingAnchorTimers) if (removeOwned(key)) {
    clearTimeout(timer);
    pendingAnchorTimers.delete(key);
  }
  delete documentState.recoveryReturns[accountId];
  flush();
}

export function saveRecoveryReturn(accountId: string, view: RecoveryReturn): void {
  documentState.recoveryReturns[accountId] = { ...view };
  flush();
}

export function readRecoveryReturn(accountId: string): RecoveryReturn | null {
  const view = documentState.recoveryReturns[accountId];
  return view ? { ...view } : null;
}

export function clearRecoveryReturn(accountId: string): void {
  delete documentState.recoveryReturns[accountId];
  flush();
}
