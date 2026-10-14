import { readFile, writeFile } from 'node:fs/promises';
const [source, destination] = process.argv.slice(2);
if(!source || !destination) throw new Error('Expected source and destination package manifests.');
const manifest = JSON.parse(await readFile(source, 'utf8'));
// The dependency-only install has no application source next to its package.json.
delete manifest.scripts;
await writeFile(destination, JSON.stringify(manifest, null, 2) + '\n');
