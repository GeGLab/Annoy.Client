// Encoded-transform worker: every outgoing frame is sealed with SFrame (RFC 9605) and every
// incoming one opened, inside WebAssembly built from the sframe crate. Keys arrive only on
// the MessagePort from the main process. Without a key a frame is dropped, never sent clear.
import wasmUrl from "./generated/annoy_sframe.wasm?url";

export type StreamKind = "audio" | "video";
export interface TransformOptions { direction: "send" | "recv"; kind: StreamKind; context: number }
export interface FrameStats { sealed: number; opened: number; dropped: Record<string, number>; epoch: string | null; streams: { send: number; recv: number }; byKind: Record<StreamKind, { sealed: number; opened: number; dropped: Record<string, number> }> }

interface Exports {
  memory: WebAssembly.Memory;
  __wbindgen_externrefs?: WebAssembly.Table;
  __wbindgen_start?: () => void;
  sf_alloc(len: number): number;
  sf_free(ptr: number, len: number): void;
  sf_set_epoch(hi: number, lo: number, index: number, ptr: number, len: number): number;
  sf_retire_before(hi: number, lo: number): void;
  sf_encrypt(context: number, ptr: number, len: number, clear: number): number;
  sf_decrypt(ptr: number, len: number, clear: number): number;
  sf_output(): number;
  sf_wipe_output(): void;
  sf_clear(): void;
}
interface EncodedFrame { data: ArrayBuffer }
interface Transformer { readable: ReadableStream<EncodedFrame>; writable: WritableStream<EncodedFrame>; options: TransformOptions }
interface Scope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  onrtctransform: ((event: { transformer: Transformer }) => void) | null;
}
const scope = self as unknown as Scope;

/** How long frames of a replaced epoch still open, while late members process the commit. */
const RETIRE_AFTER_MS = 10_000;
const ERRORS: Record<number, string> = { [-1]: "no_key", [-2]: "invalid_key", [-3]: "invalid_context", [-4]: "stale_epoch", [-5]: "malformed", [-6]: "rejected", [-7]: "replay", [-8]: "exhausted" };

let wasm: Exports | null = null;
let input = { ptr: 0, len: 0 };
let current: bigint | null = null;
const stats: FrameStats = { sealed: 0, opened: 0, dropped: {}, epoch: null, streams: { send: 0, recv: 0 }, byKind: {audio:{sealed:0,opened:0,dropped:{}},video:{sealed:0,opened:0,dropped:{}}} };

const ready = (async () => {
  const module = await WebAssembly.compileStreaming(fetch(wasmUrl));
  // wasm-bindgen leaves one import: initialising its externref table, which this module never uses otherwise.
  const imports: WebAssembly.Imports = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.name !== "__wbindgen_init_externref_table") throw new Error("Unexpected SFrame module import " + entry.name);
    imports[entry.module] = {
      [entry.name]: () => {
        const table = wasm!.__wbindgen_externrefs!;
        table.set(0, undefined);
        table.set(1024, undefined);
        table.set(1025, null);
        table.set(1026, true);
        table.set(1027, false);
      },
    };
  }
  const instance = await WebAssembly.instantiate(module, imports);
  wasm = instance.exports as unknown as Exports;
  wasm.__wbindgen_start?.();
})();

function drop(reason: string, kind?: StreamKind): void {
  stats.dropped[reason] = (stats.dropped[reason] ?? 0) + 1;
  if(kind)stats.byKind[kind].dropped[reason]=(stats.byKind[kind].dropped[reason]??0)+1;
}

/** VP8 packetizers and depacketizers read the frame tag and, on key frames, the dimensions. */
function clearBytes(kind: StreamKind, data: Uint8Array): number {
  if (kind !== "video" || data.length === 0) return 0;
  return Math.min(data.length, (data[0]! & 1) === 0 ? 10 : 3);
}

function transformFrame(options: TransformOptions, frame: EncodedFrame): boolean {
  if (!wasm) return drop("not_ready", options.kind), false;
  const data = new Uint8Array(frame.data);
  if (data.length > input.len) {
    if (input.ptr) wasm.sf_free(input.ptr, input.len);
    input = { len: Math.max(data.length, 64 * 1024), ptr: 0 };
    input.ptr = wasm.sf_alloc(input.len);
  }
  new Uint8Array(wasm.memory.buffer, input.ptr, data.length).set(data);
  const clear = clearBytes(options.kind, data);
  const result = options.direction === "send" ? wasm.sf_encrypt(options.context, input.ptr, data.length, clear) : wasm.sf_decrypt(input.ptr, data.length, clear);
  new Uint8Array(wasm.memory.buffer, input.ptr, data.length).fill(0);
  if (result < 0) {
    drop(ERRORS[result] ?? "error", options.kind);
    return false;
  }
  const out = new Uint8Array(result);
  out.set(new Uint8Array(wasm.memory.buffer, wasm.sf_output(), result));
  wasm.sf_wipe_output();
  if (options.direction === "recv") data.fill(0);
  frame.data = out.buffer;
  if (options.direction === "send") {stats.sealed++;stats.byKind[options.kind].sealed++;}
  else {stats.opened++;stats.byKind[options.kind].opened++;}
  return true;
}

function attach(readable: ReadableStream<EncodedFrame>, writable: WritableStream<EncodedFrame>, options: TransformOptions): void {
  if ((options.direction !== "send" && options.direction !== "recv") || (options.kind !== "audio" && options.kind !== "video") || !Number.isInteger(options.context)) return;
  stats.streams[options.direction]++;
  void readable
    .pipeThrough(
      new TransformStream<EncodedFrame, EncodedFrame>({
        transform(frame, controller) {
          if (transformFrame(options, frame)) controller.enqueue(frame);
        },
      }),
    )
    .pipeTo(writable)
    .catch((error: Error) => { drop(`pipeline_${error.name}`, options.kind); scope.postMessage({type:"stream-failed"}); });
}

function installKey(message: { epoch?: unknown; senderIndex?: unknown; key?: unknown }): void {
  const key = message.key;
  try {
    if (!wasm || typeof message.epoch !== "string" || !/^\d{1,20}$/.test(message.epoch) || !Number.isInteger(message.senderIndex) || !(key instanceof Uint8Array)) return drop("invalid_key");
    const epoch = BigInt(message.epoch);
    const ptr = wasm.sf_alloc(key.length);
    new Uint8Array(wasm.memory.buffer, ptr, key.length).set(key);
    // The module wipes its copy of the input; the buffer is released afterwards.
    const result = wasm.sf_set_epoch(Number(epoch >> 32n), Number(epoch & 0xffffffffn), message.senderIndex as number, ptr, key.length);
    wasm.sf_free(ptr, key.length);
    if (result < 0) return drop(ERRORS[result] ?? "invalid_key");
    current = epoch;
    stats.epoch = message.epoch;
    setTimeout(() => {
      if (wasm && current !== null && current >= epoch) wasm.sf_retire_before(Number(epoch >> 32n), Number(epoch & 0xffffffffn));
    }, RETIRE_AFTER_MS);
  } finally {
    if (key instanceof Uint8Array) key.fill(0);
  }
}

scope.onrtctransform = (event) => {
  const { readable, writable, options } = event.transformer;
  attach(readable, writable, options);
};

scope.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as { type?: string; port?: MessagePort; readable?: ReadableStream<EncodedFrame>; writable?: WritableStream<EncodedFrame>; options?: TransformOptions };
  if (data?.type === "keys" && data.port) {
    const port = data.port;
    port.onmessage = (keys) => void ready.then(() => installKey(keys.data));
    port.start();
  } else if (data?.type === "stream" && data.readable && data.writable && data.options) {
    attach(data.readable, data.writable, data.options);
  } else if (data?.type === "stats") {
    scope.postMessage({ type: "stats", stats });
  } else if (data?.type === "close") {
    wasm?.sf_clear();
    current = null;
    stats.epoch = null;
  }
});

void ready.then(
  () => scope.postMessage({ type: "ready" }),
  () => scope.postMessage({ type: "failed" }),
);
