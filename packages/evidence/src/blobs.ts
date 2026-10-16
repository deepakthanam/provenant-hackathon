import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from './crypto';

export interface StoredBlob {
  sha256: string;
  /** Store-relative path, e.g. `blobs/<sha256>`. */
  path: string;
  size: number;
}

/** Content-addressed blob storage. Local disk now; an S3-compatible store can implement the same shape. */
export interface BlobStore {
  put(bytes: Uint8Array): Promise<StoredBlob>;
  get(sha256: string): Promise<Uint8Array | null>;
}

export class LocalBlobStore implements BlobStore {
  constructor(private readonly dataDir: string) {}

  async put(bytes: Uint8Array): Promise<StoredBlob> {
    const sha256 = sha256Hex(bytes);
    const dir = join(this.dataDir, 'blobs');
    const file = join(dir, sha256);
    if (!existsSync(file)) {
      await mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, file);
    }
    return { sha256, path: `blobs/${sha256}`, size: bytes.byteLength };
  }

  async get(sha256: string): Promise<Uint8Array | null> {
    if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
    const file = join(this.dataDir, 'blobs', sha256);
    if (!existsSync(file)) return null;
    const bytes = await readFile(file);
    // A blob whose bytes no longer match its name has been tampered with; refuse to serve it.
    return sha256Hex(bytes) === sha256 ? bytes : null;
  }
}
