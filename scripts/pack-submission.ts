/**
 * Builds dist/provenant-submission-pack.zip for the Devpost "Upload a file" field:
 * submission answers, demo script, presentation source, docs, diagram prompt and screenshots.
 * Uses only Node's zlib (deflate + crc32), so it needs no extra dependency.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist', 'provenant-submission-pack.zip');

const include = [
  'README.md',
  'LICENSE',
  'docs/submission.md',
  'docs/demo-script.md',
  'docs/presentation.md',
  'docs/architecture.md',
  'docs/verdicts.md',
  'docs/api.md',
  'demo_script/narration.txt',
  'prompts/architecture-diagram.md',
  'docs/screenshots',
];

function walk(path: string): string[] {
  const abs = join(root, path);
  if (!statSync(abs, { throwIfNoEntry: false })) {
    console.warn(`skipped (missing): ${path}`);
    return [];
  }
  if (!statSync(abs).isDirectory()) return [path];
  return readdirSync(abs).flatMap((f) => walk(`${path}/${f}`));
}

const files = include.flatMap(walk);
const locals: Buffer[] = [];
const centrals: Buffer[] = [];
let offset = 0;

// DOS date/time for "now" (zip stores local time with 2-second resolution).
const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

for (const file of files) {
  const data = readFileSync(join(root, file));
  const packed = deflateRawSync(data, { level: 9 });
  const name = Buffer.from(
    `provenant-submission-pack/${relative(root, join(root, file)).replace(/\\/g, '/')}`,
  );
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + packed.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(join(root, 'dist'), { recursive: true });
const zip = Buffer.concat([...locals, ...centrals, end]);
writeFileSync(out, zip);
console.log(`${relative(root, out)}: ${files.length} files, ${(zip.length / 1024 / 1024).toFixed(2)} MB`);
if (zip.length > 35 * 1024 * 1024) console.warn('Over the 35 MB Devpost limit.');
