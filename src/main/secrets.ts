import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { OsStorage } from "./safe-storage.ts";

/** Serialize reads/rotation/writes so async encryption cannot lose another key. */
export class SecretStore {
  private queue: Promise<unknown> = Promise.resolve();
  private file: string;
  private storage: OsStorage;
  constructor(file: string, storage: OsStorage) { this.file = file; this.storage = storage; }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async read(): Promise<Record<string, string>> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return Object.fromEntries(Object.entries(value).filter(([, value]) => typeof value === "string"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error; // Never overwrite an unreadable file with an empty store.
    }
  }
  private async write(all: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(all), { mode: 0o600, flag: "wx" });
      await rename(temporary, this.file);
    } finally { await unlink(temporary).catch(() => undefined); }
  }
  get(name: string): Promise<string | null> {
    return this.serial(async () => {
      if (!await this.storage.available()) return null;
      const all = await this.read(), sealed = all[name];
      if (!sealed) return null;
      const decrypted = await this.storage.decrypt(Buffer.from(sealed, "base64"));
      if (typeof decrypted === "string") return decrypted;
      if (decrypted.shouldReEncrypt) {
        const replacement = (await this.storage.encrypt(decrypted.result)).toString("base64");
        await this.write({ ...all, [name]: replacement });
      }
      return decrypted.result;
    });
  }
  set(name: string, value: string | null): Promise<boolean> {
    return this.serial(async () => {
      if (value !== null && !await this.storage.available()) return false;
      const all = await this.read();
      if (value === null) delete all[name];
      else all[name] = (await this.storage.encrypt(value)).toString("base64");
      await this.write(all);
      return name in all;
    });
  }
}
