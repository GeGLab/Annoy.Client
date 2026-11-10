import { deflateRawSync } from "node:zlib";

/** Build tiny ZIP fixtures without a package dependency. */
export function mediaZip(entries: { name: string; data: Buffer; method?: number; declaredSize?: number; badCrc?: boolean; flags?: number }[]) {
  const files: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8, name = Buffer.from(entry.name), data = method === 8 ? deflateRawSync(entry.data) : entry.data;
    let crc = 0xffffffff;
    for (const byte of entry.data) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    crc = entry.badCrc ? 0 : (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(entry.flags ?? 0x800, 6); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(entry.declaredSize ?? entry.data.length, 22); header.writeUInt16LE(name.length, 26);
    files.push(header, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(entry.flags ?? 0x800, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(entry.declaredSize ?? entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, name); offset += header.length + name.length + data.length;
  }
  const index = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, index, end]);
}
