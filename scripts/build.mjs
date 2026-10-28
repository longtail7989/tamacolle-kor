#!/usr/bin/env node
// Dependency-free ZIP STORE: explicit files, stable order, fixed timestamps and attributes.
import {readFile, lstat, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validatePack} from '../resource-pack.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [
  'manifest.json', 'background.mjs', 'resource-pack.mjs', 'resource-store.mjs',
  'github-release.mjs', 'main.js', 'content.js', 'image-policy.js',
  'game-adapter.js', 'dialogue-text.js', 'name-policy.js', 'story-policy.js',
  'popup.html', 'popup.js', 'popup.css', 'icons/icon16.png', 'icons/icon32.png',
  'icons/icon48.png', 'icons/icon128.png', 'resources/ko.json'
].sort();
let tag;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--tag' && process.argv[i + 1] && tag === undefined) tag = process.argv[++i];
  else throw Error('사용법: node scripts/build.mjs [--tag resource-vX.Y.Z]');
}

async function allowlistedFile(file) {
  const parts = file.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw Error('일반 배포 파일만 허용합니다: ' + file);
  }
  return readFile(current);
}

const manifest = JSON.parse((await allowlistedFile('manifest.json')).toString('utf8'));
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) throw Error('확장 버전은 x.y.z여야 합니다.');
const resources = await allowlistedFile('resources/ko.json');
const pack = await validatePack(resources.toString('utf8'), {extensionVersion: manifest.version});
if (tag !== undefined && tag !== 'resource-v' + pack.version) throw Error('태그는 리소스 버전과 같은 resource-v' + pack.version + ' 이어야 합니다.');
const declared = [
  manifest.background?.service_worker, manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.content_scripts || []).flatMap(script => [...(script.js || []), ...(script.css || [])]),
  ...(manifest.web_accessible_resources || []).flatMap(entry => entry.resources || [])
].filter(Boolean);
for (const file of declared) if (!files.includes(file)) throw Error('manifest의 파일이 배포 허용 목록에 없습니다: ' + file);

const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const local = [], central = [];
let offset = 0;
for (const file of files) {
  const data = file === 'resources/ko.json' ? resources : await allowlistedFile(file);
  const name = Buffer.from(file, 'utf8'), crc = crc32(data);
  if (data.length > 0xffffffff || offset > 0xffffffff) throw Error('ZIP64 크기는 지원하지 않습니다.');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(0x21, 12); // 1980-01-01 00:00:00, no machine-local timestamps.
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, data);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x800, 8);
  entry.writeUInt16LE(0x21, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(data.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(0x20, 38);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += header.length + name.length + data.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...local, directory, end]);
const zipName = `tamacolle-kor-${manifest.version}-extension.zip`;
const resourceName = 'tamacolle-kor-resources.json';
const checksum = (name, bytes) => createHash('sha256').update(bytes).digest('hex') + '  ' + name + '\n';
const dist = path.join(root, 'dist');
await mkdir(dist, {recursive: true});
await writeFile(path.join(dist, zipName), zip);
await writeFile(path.join(dist, resourceName), resources);
await writeFile(path.join(dist, 'SHA256SUMS'), checksum(zipName, zip) + checksum(resourceName, resources));
console.log(`${zipName}: ${files.length} allowlisted files, ${zip.length} bytes\n${resourceName}: ${resources.length} bytes, ${pack.texts.length} texts, ${pack.images.length} images, resource ${pack.version}\nSHA256SUMS`);
