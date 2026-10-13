import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const [directory, manifestFile] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
for (const [name, expected] of Object.entries(manifest.files)) {
  if (!/^[\w./-]+$/.test(name) || name.split('/').includes('..') || path.isAbsolute(name)) throw new Error(`Invalid payload path: ${name}`);
  const bytes = await readFile(path.join(directory, name));
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Payload checksum mismatch: ${name}`);
}
console.log(`Verified ${Object.keys(manifest.files).length} application files.`);
