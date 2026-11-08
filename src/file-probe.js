import { open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';

// DSH 0.2.2 fs-local uses this opaque metadata token. Only equality is consumed.
const token = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
const iso = ns => Number(ns) > 0 ? new Date(Number(ns / 1000000n)).toISOString() : null;
/** Read one instruction file, never resources, with a bounded stable descriptor read. */
export async function probeFile(path, { maxFileBytes = 1048576, signal } = {}) {
  let handle;
  try {
    signal?.throwIfAborted();
    const beforeOpen = await stat(path, { bigint: true });
    if (!beforeOpen.isFile()) return { status: 'unknown', warning: 'not-a-regular-file' };
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) return { status: 'unknown', warning: 'not-a-regular-file' };
    const details = { status: 'present', createdAt: iso(before.birthtimeNs), modifiedAt: iso(before.mtimeNs), version: token(before) };
    if (before.size > BigInt(maxFileBytes)) return { ...details, contentHash: null, warning: 'instruction-file-too-large' };
    const buffer = Buffer.alloc(maxFileBytes + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      signal?.throwIfAborted();
      const read = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (read.bytesRead === 0) break;
      bytes += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (token(before) !== token(after)) return { status: 'unknown', warning: 'instruction-file-changed-during-read' };
    if (bytes > maxFileBytes) return { ...details, contentHash: null, warning: 'instruction-file-too-large' };
    return { ...details, contentHash: createHash('sha256').update(buffer.subarray(0, bytes)).digest('hex') };
  } catch (error) {
    signal?.throwIfAborted();
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { status: 'missing' };
    return { status: 'unknown', warning: error.code === 'EACCES' || error.code === 'EPERM' ? 'instruction-file-unreadable' : 'instruction-file-check-failed' };
  } finally { if (handle) await handle.close(); }
}
