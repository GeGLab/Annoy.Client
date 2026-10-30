export type MediaKind = "emoji" | "gif" | "sticker";
export interface MediaItem { id: string; name: string; kind: MediaKind; emoji?: string; url?: string; blob?: Blob; }
export interface MediaPack { id: string; name: string; author: string; license: string; source: string; items: MediaItem[]; }
const entries = [
 ["😀","sorriso feliz"], ["😃","alegre"], ["😄","rindo"], ["😁","sorriso dentes"], ["😆","risada"], ["😅","suor alívio"], ["😂","chorando de rir"], ["🤣","gargalhada"], ["😊","tímido feliz"], ["🙂","sorriso leve"], ["🙃","invertido"], ["😉","piscando"], ["😍","apaixonado"], ["🥰","amor"], ["😘","beijo"], ["😎","óculos legal"], ["🤓","nerd"], ["🤔","pensando"], ["🤨","desconfiado"], ["😐","neutro"], ["😴","dormindo"], ["🤤","babando"], ["😢","triste choro"], ["😭","chorando"], ["😤","bravo"], ["😡","raiva"], ["🤯","explodindo"], ["🥺","por favor"], ["😱","grito"], ["😳","surpreso"], ["🙄","olhos"], ["🤡","palhaço"], ["💀","caveira"], ["👻","fantasma"], ["👽","alien"], ["🤖","robô"], ["💩","cocô"], ["🔥","fogo"], ["✨","brilho"], ["🎉","festa"], ["❤️","coração amor"], ["💜","coração roxo"], ["💛","coração amarelo"], ["💔","coração partido"], ["👍","positivo gostei"], ["👎","negativo"], ["👏","palmas"], ["🙌","celebrar"], ["🙏","obrigado"], ["💪","força"], ["👀","olhando"], ["✅","certo"], ["❌","errado"], ["💯","cem"], ["🚀","foguete"], ["🎮","jogo"], ["🎵","música"], ["☕","café"], ["🍕","pizza"], ["🐱","gato"], ["🐶","cachorro"], ["🐸","sapo"], ["🦊","raposa"], ["🐼","panda"], ["🦄","unicórnio"], ["🌈","arco íris"], ["🌙","lua"], ["⭐","estrela"]
];
export const EMOJIS: MediaItem[] = entries.map(([emoji, name], index) => ({ id: `unicode-${index}`, name: name!, emoji: emoji!, kind: "emoji" }));
const bundledBase = new URL(`${import.meta.env.BASE_URL}expression/`, window.location.href).href;
export const CATALOG: MediaPack[] = [
 { id: "reactions", name: "Reações do dia a dia", author: "Unicode", license: "Caracteres Unicode", source: "https://unicode.org/emoji/", items: EMOJIS.filter((item) => ["positivo gostei", "palmas", "obrigado", "coração amor", "fogo", "chorando de rir", "olhando", "festa", "pensando", "certo"].includes(item.name)) },
 { id: "openmoji-animals", name: "Bichos do OpenMoji", author: "OpenMoji", license: "CC BY-SA 4.0", source: "https://openmoji.org/", items: [["1F431","Gato"],["1F436","Cachorro"],["1F438","Sapo"],["1F98A","Raposa"],["1F43C","Panda"],["1F984","Unicórnio"]].map(([code,name]) => ({ id: code!, name: name!, kind: "sticker", url: `${bundledBase}openmoji/${code}.png` })) }
];
let database: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("annoy-expression", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("packs", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(new Error("Não foi possível abrir sua biblioteca.")); };
  });
}
async function access<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("packs", mode), request = action(transaction.objectStore("packs"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(new Error("Não foi possível salvar a biblioteca. Confira o espaço disponível."));
    transaction.onabort = () => reject(new Error("A alteração na biblioteca foi cancelada."));
  });
}
export const readPacks = () => access<MediaPack[]>("readonly", (store) => store.getAll());
export const savePack = (pack: MediaPack) => access("readwrite", (store) => store.put(pack));
export const removePack = (id: string) => access("readwrite", (store) => store.delete(id));
export async function downloadMedia(url: string, signal?: AbortSignal): Promise<Blob> {
  const embedded = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
  if (embedded) {
    if (embedded[2]!.length > Math.ceil(8 * 1024 * 1024 / 3) * 4) throw new Error("Cada imagem pode ter até 8 MB.");
    const binary = atob(embedded[2]!);
    if (binary.length > 8 * 1024 * 1024) throw new Error("Cada imagem pode ter até 8 MB.");
    return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: embedded[1] });
  }
  if (!url.startsWith(bundledBase) && !/^https:\/\//.test(url) && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(url)) throw new Error("Use imagens HTTPS ou imagens incorporadas no pacote.");
  const response = await fetch(url, { credentials: "omit", signal: signal ?? AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw new Error("Não foi possível baixar a imagem.");
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8 * 1024 * 1024) throw new Error("Cada imagem pode ter até 8 MB."); chunks.push(value as Uint8Array<ArrayBuffer>); }
  } finally { await reader.cancel(); }
  const type = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error("Use PNG, JPEG, WebP ou GIF.");
  return new Blob(chunks, { type });
}
export async function installPack(pack: MediaPack): Promise<void> {
  if (pack.items.length > 60) throw new Error("O pacote pode ter até 60 itens.");
  let total = 0; const items: MediaItem[] = [];
  for (const item of pack.items) {
    if (item.emoji) items.push(item);
    else { const blob = item.blob ?? await downloadMedia(item.url!); total += blob.size; if (total > 50 * 1024 * 1024) throw new Error("O pacote pode ter até 50 MB."); items.push({ ...item, url: undefined, blob }); }
  }
  await savePack({ ...pack, items });
}
export function parsePack(raw: unknown): MediaPack {
  const pack = raw as Partial<MediaPack>;
  if (!pack || typeof pack.name !== "string" || !pack.name.trim() || pack.name.length > 80 || typeof pack.author !== "string" || pack.author.length > 120 || typeof pack.license !== "string" || pack.license.length > 120 || typeof pack.source !== "string" || pack.source.length > 500 || !Array.isArray(pack.items) || !pack.items.length || pack.items.length > 60) throw new Error("Pacote inválido. Informe nome, autor, licença, origem e até 60 itens.");
  const items = pack.items.map((item, index): MediaItem => {
    if (!item || typeof item.name !== "string" || item.name.length > 80 || !["emoji","gif","sticker"].includes(item.kind)) throw new Error("Item inválido no pacote.");
    if (item.emoji) {
      if (typeof item.emoji !== "string" || item.emoji.length > 32 || [...new Intl.Segmenter("und", {granularity:"grapheme"}).segment(item.emoji)].length !== 1 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(item.emoji)) throw new Error("Emoji inválido.");
      return { id: String(index), name: item.name, kind: "emoji", emoji: item.emoji };
    }
    if (typeof item.url !== "string" || item.url.length > 12 * 1024 * 1024) throw new Error("Imagem ausente no pacote.");
    return { id: String(index), name: item.name, kind: item.kind, url: item.url };
  });
  return { id: `import-${crypto.randomUUID()}`, name: pack.name, author: pack.author, license: pack.license, source: pack.source, items };
}
export async function exportPack(pack: MediaPack): Promise<Blob> {
  const items = await Promise.all(pack.items.map(async ({blob, ...item}) => {
    if (!blob) return item;
    const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
    return { ...item, url };
  }));
  return new Blob([JSON.stringify({...pack,items}, null, 2)], { type: "application/json" });
}
