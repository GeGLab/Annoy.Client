export type MediaKind = "emoji" | "gif" | "sticker";
export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  emoji?: string;
  url?: string;
  blob?: Blob;
  packId?: string;
  sha256?: string;
}
export interface MediaPack {
  id: string;
  name: string;
  author: string;
  license: string;
  source: string;
  version?: string;
  credits?: string;
  licenseUrl?: string;
  items: MediaItem[];
}
export interface PackMetadata extends Omit<MediaPack, "items"> {
  itemCount: number;
  kinds: MediaKind[];
}
export interface MediaPage<T> { items: T[]; next: string | null; }
export const searchText = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
