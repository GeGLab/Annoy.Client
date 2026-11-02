export interface DecryptedSecret { result: string; shouldReEncrypt: boolean }
export interface OsStorage {
  available(): boolean | Promise<boolean>;
  encrypt(value: string): Buffer | Promise<Buffer>;
  decrypt(value: Buffer): string | DecryptedSecret | Promise<string | DecryptedSecret>;
}
interface AsyncSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<DecryptedSecret>;
  getSelectedStorageBackend(): string;
}
/** No synchronous Electron crypto, and no Linux plaintext fallback. */
export function osStorage(api: AsyncSafeStorage, platform: NodeJS.Platform = process.platform): OsStorage {
  return {
    available: async () => {
      try { return await api.isAsyncEncryptionAvailable() && (platform !== "linux" || !["basic_text", "unknown"].includes(api.getSelectedStorageBackend())); }
      catch { return false; }
    },
    encrypt: (value) => api.encryptStringAsync(value),
    decrypt: (value) => api.decryptStringAsync(value),
  };
}
