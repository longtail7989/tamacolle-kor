#!/usr/bin/env node
// Read only these public authoring files; never import executable authoring modules.
import {readFile, lstat, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const APP_VERSION = '0.1.0';
const MAX_PACK_BYTES = 32 * 1024 * 1024;
const PUBLIC_TEXT_FILES = ['tamacolle-fixed-ui-ko.json', 'tamacolle-main-story-ko.json'];
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function publicFile(from, relative) {
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) throw Error('공개 파일 경로가 올바르지 않습니다: ' + relative);
  let current = from;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw Error('일반 공개 파일만 가져올 수 있습니다: ' + relative);
  }
  return readFile(current);
}

function protectedValues(text) {
  if (/⟦[A-Za-z0-9]+_\d+⟧/.test(text)) throw Error('보호 토큰 충돌');
  return text.match(/<[^>]*>|\{[^{}]*\}|\r\n|\r|\n|[+＋\-－]?[0-9０-９]+(?:[,，][0-9０-９]{3})*(?:[.．][0-9０-９]+)?(?:[%％])?/g) || [];
}

function textEntry(entry, file) {
  const {source, text, context} = entry;
  if (typeof source !== 'string' || !source.trim() || source.length > 8192 || typeof text !== 'string' || !text.trim() || text.length > Math.max(512, source.length * 6) || typeof context !== 'string' || context.length > 300 || entry.target !== '한국어') throw Error('공개 텍스트 형식 오류: ' + file);
  const a = protectedValues(source), b = protectedValues(text);
  const ordinaryA = a.filter(value => value !== '{USER}'), ordinaryB = b.filter(value => value !== '{USER}');
  if (a.length - ordinaryA.length !== b.length - ordinaryB.length || JSON.stringify(ordinaryA) !== JSON.stringify(ordinaryB)) throw Error('수치·태그·변수·줄바꿈 불일치: ' + source.slice(0, 80));
  // Keep raw strings, including story context and whitespace; omit IDs and private timestamps.
  return {source, text, context};
}

export async function assemblePack({from, version}) {
  if (!from || !versionPattern.test(version)) throw Error('--from 공개 저작 폴더 --version x.y.z 가 필요합니다.');
  from = path.resolve(from);
  const texts = [], sources = new Set();
  for (const file of PUBLIC_TEXT_FILES) {
    const data = JSON.parse((await publicFile(from, file)).toString('utf8'));
    if (data.format !== 'tamacolle-ai-translation-cache' || data.version !== 3 || data.identity !== 'source-v3' || data.appVersion !== APP_VERSION || !Array.isArray(data.entries)) throw Error('지원하지 않는 공개 텍스트 파일: ' + file);
    for (const raw of data.entries) {
      const entry = textEntry(raw, file);
      if (sources.has(entry.source)) throw Error('중복/충돌 원문: ' + entry.source.slice(0, 80));
      sources.add(entry.source);
      texts.push(entry);
    }
  }
  if (!texts.length || texts.length > 50000) throw Error('텍스트 개수 제한 초과');
  const catalogSource = (await publicFile(from, 'image-catalog.js')).toString('utf8');
  const prefix = "/* Korean fixed UI patches; source fingerprints and geometry are verified before replacement. */\n(()=>{'use strict';globalThis[Symbol.for('tamacolle-ai-image-catalog.v1')]=Object.freeze(";
  const normalized = catalogSource.replace(/\r\n/g, '\n').trim();
  const suffix = ');})();';
  if (!normalized.startsWith(prefix) || !normalized.endsWith(suffix)) throw Error('공개 이미지 카탈로그 래퍼가 변경되었습니다. JSON 데이터만 허용합니다.');
  const catalog = JSON.parse(normalized.slice(prefix.length, -suffix.length));
  if (!Array.isArray(catalog) || !catalog.length || catalog.length > 2000) throw Error('이미지 카탈로그 개수 오류');
  const keys = new Set(), assets = new Set(), images = [];
  for (const item of catalog) {
    if (!item || !/^[-a-zA-Z0-9_]{1,96}$/.test(item.key) || keys.has(item.key) || item.asset !== 'image-patches/' + item.key.toLowerCase() + '.png' || assets.has(item.asset)) throw Error('이미지 공개 경로/키 오류');
    keys.add(item.key); assets.add(item.asset);
    const png = await publicFile(from, item.asset);
    if (png.length < 33 || png.length > 512 * 1024 || !png.subarray(0, 8).equals(pngSignature) || png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR' || png.readUInt32BE(16) !== item.width || png.readUInt32BE(20) !== item.height) throw Error('PNG 크기/헤더 불일치: ' + item.key);
    const {asset, ...metadata} = item;
    images.push({...metadata, dataUrl: 'data:image/png;base64,' + png.toString('base64'), pngHash: createHash('sha256').update(png).digest('hex')});
  }
  const pack = {format: 'tamacolle-kor-resources', schemaVersion: 1, version, minimumExtensionVersion: APP_VERSION, texts, images};
  if (Buffer.byteLength(JSON.stringify(pack) + '\n') > MAX_PACK_BYTES) throw Error('리소스 팩이 32MiB를 초과합니다.');
  return pack;
}

async function main() {
  let from, version;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--from' && process.argv[i + 1] && !from) from = process.argv[++i];
    else if (process.argv[i] === '--version' && process.argv[i + 1] && !version) version = process.argv[++i];
    else throw Error('사용법: node scripts/import-translator.mjs --from AUTHORING_ROOT --version x.y.z');
  }
  const pack = await assemblePack({from, version});
  const bytes = Buffer.from(JSON.stringify(pack) + '\n');
  const {validatePack} = await import('../resource-pack.mjs');
  await validatePack(bytes.toString('utf8'), {extensionVersion: APP_VERSION});
  await mkdir(path.join(root, 'resources'), {recursive: true});
  await writeFile(path.join(root, 'resources/ko.json'), bytes);
  console.log(`resources/ko.json: ${pack.texts.length} texts, ${pack.images.length} images, ${bytes.length} bytes; resource ${pack.version}, extension ${APP_VERSION}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
