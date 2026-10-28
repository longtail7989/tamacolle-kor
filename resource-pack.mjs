import './dialogue-text.js';

export const MAX_PACK_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 512 * 1024;
const dialogue = globalThis[Symbol.for('tamacolle-kor-dialogue-text.v1')];
const encoder = new TextEncoder();
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && value.length === 64;
const plain = value => value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = message => { throw new Error(`리소스 파일: ${message}`); };
function keys(value, required, optional = []) {
  if (!plain(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('필드 구성이 올바르지 않습니다.');
}
function versionParts(value) {
  if (typeof value !== 'string' || value.trim() !== value || !versionPattern.test(value)) fail('버전은 x.y.z 형식이어야 합니다.');
  return value.split('.').map(BigInt);
}
export function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}

// JSON.parse accepts duplicate properties. Scan the already syntax-checked JSON to reject
// ambiguous files, including escaped spellings of the same property name.
function rejectDuplicateKeys(text) {
  let position = 0;
  const whitespace = () => { while (/\s/.test(text[position] || '') && position < text.length) position++; };
  function string() {
    const start = position++;
    while (position < text.length) {
      const character = text[position++];
      if (character === '\\') position++;
      else if (character === '"') return text.slice(start, position);
    }
  }
  function value(depth) {
    if (depth > 32) fail('JSON 중첩이 너무 깊습니다.');
    whitespace();
    if (text[position] === '{') {
      position++; whitespace(); const seen = new Set();
      if (text[position] === '}') { position++; return; }
      for (;;) {
        whitespace(); const key = JSON.parse(string());
        if (seen.has(key)) fail(`중복 JSON 필드가 있습니다: ${key}`);
        seen.add(key); whitespace(); position++; value(depth + 1); whitespace();
        if (text[position++] === '}') return;
      }
    }
    if (text[position] === '[') {
      position++; whitespace();
      if (text[position] === ']') { position++; return; }
      for (;;) { value(depth + 1); whitespace(); if (text[position++] === ']') return; }
    }
    if (text[position] === '"') { string(); return; }
    while (position < text.length && !/[\s,\]}]/.test(text[position])) position++;
  }
  value(0);
}
function parse(raw) {
  let text;
  try {
    if (typeof raw === 'string') text = raw;
    else if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
      const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      if (bytes.byteLength > MAX_PACK_BYTES) fail('파일이 32MiB 제한을 초과합니다.');
      text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } else {
      if (!plain(raw)) fail('JSON 객체가 필요합니다.');
      text = JSON.stringify(raw, (_, value) => {
        if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)) || (value !== null && typeof value === 'object' && !Array.isArray(value) && !plain(value))) fail('JSON으로 표현할 수 없는 값이 있습니다.');
        return value;
      });
    }
    if (encoder.encode(text).byteLength > MAX_PACK_BYTES) fail('파일이 32MiB 제한을 초과합니다.');
    const pack = JSON.parse(text);
    rejectDuplicateKeys(text);
    return pack;
  } catch (error) {
    if (error?.message?.startsWith('리소스 파일:')) throw error;
    fail('올바른 UTF-8 JSON 파일이 아닙니다.');
  }
}
const protectedPattern = /<[^>]*>|\{[^{}]*\}|\r\n|\r|\n|[+＋\-－]?[0-9０-９]+(?:[,，][0-9０-９]{3})*(?:[.．][0-9０-９]+)?(?:[%％])?/g;
function tokens(text) {
  if (/⟦[A-Za-z0-9]+_\d+⟧/.test(text)) fail('보호 토큰 표기가 남아 있습니다.');
  return text.match(protectedPattern) || [];
}
function validateText(entry) {
  keys(entry, ['source', 'text', 'context']);
  const {source, text, context} = entry;
  if (typeof source !== 'string' || !source.trim() || source.length > 8192 || typeof text !== 'string' || !text.trim() || text.length > Math.max(512, source.length * 6) || typeof context !== 'string' || context.length > 300) fail('원문·번역문·문맥의 길이가 올바르지 않습니다.');
  const left = tokens(source), right = tokens(text);
  const ordinaryLeft = left.filter(token => token !== '{USER}'), ordinaryRight = right.filter(token => token !== '{USER}');
  if (left.length - ordinaryLeft.length !== right.length - ordinaryRight.length || JSON.stringify(ordinaryLeft) !== JSON.stringify(ordinaryRight)) fail('원문과 번역문의 수치·태그·변수·줄바꿈 또는 {USER} 개수가 일치하지 않습니다.');
  return Object.freeze(entry);
}
const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc(bytes, start, end) {
  let value = 0xffffffff;
  for (let i = start; i < end; i++) value = crcTable[(value ^ bytes[i]) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
async function validateImage(entry) {
  keys(entry, ['key', 'name', 'sourcePath', 'rect', 'width', 'height', 'revision', 'sourceHash', 'translation', 'sourceOrigin', 'dataUrl', 'pngHash'], ['uuid', 'asset', 'sourcePixelHash']);
  if (typeof entry.key !== 'string' || !/^[-a-zA-Z0-9_]{1,96}$/.test(entry.key) || entry.key.trim() !== entry.key || !isHash(entry.sourceHash) || !isHash(entry.pngHash) || (Object.hasOwn(entry, 'sourcePixelHash') && !isHash(entry.sourcePixelHash))) fail('PNG 식별자 또는 SHA256이 올바르지 않습니다.');
  for (const field of ['name', 'uuid', 'sourcePath', 'revision', 'sourceOrigin']) if (!(field === 'uuid' && !Object.hasOwn(entry, field)) && (typeof entry[field] !== 'string' || (!entry[field] && field !== 'name' && field !== 'uuid') || entry[field].length > 2048)) fail('PNG 원본 메타데이터가 올바르지 않습니다.');
  if (entry.revision.length > 96 || typeof entry.translation !== 'string' || entry.translation.length > 8192 || !entry.sourcePath.startsWith('/') || /[?#\\]/.test(entry.sourcePath)) fail('PNG 원본 경로 또는 번역 정보가 올바르지 않습니다.');
  try { const origin = new URL(entry.sourceOrigin); if (origin.protocol !== 'https:' || origin.origin !== entry.sourceOrigin || origin.username || origin.password) fail('PNG 원본 출처가 올바르지 않습니다.'); } catch { fail('PNG 원본 출처가 올바르지 않습니다.'); }
  if (Object.hasOwn(entry, 'asset') && (typeof entry.asset !== 'string' || !/^image-patches\/[-a-zA-Z0-9_]{1,96}\.png$/.test(entry.asset))) fail('PNG 자산 경로가 올바르지 않습니다.');
  if (![entry.width, entry.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 8192) || !Array.isArray(entry.rect) || entry.rect.length !== 4 || !entry.rect.every(value => Number.isSafeInteger(value) && value >= 0) || entry.rect[2] !== entry.width || entry.rect[3] !== entry.height) fail('PNG 원본 영역과 크기가 일치하지 않습니다.');
  const prefix = 'data:image/png;base64,';
  if (typeof entry.dataUrl !== 'string' || !entry.dataUrl.startsWith(prefix) || entry.dataUrl.length > prefix.length + 4 * Math.ceil(MAX_IMAGE_BYTES / 3)) fail('PNG 데이터가 없거나 512KiB 제한을 초과합니다.');
  const base64 = entry.dataUrl.slice(prefix.length);
  if (!base64 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) fail('PNG base64가 올바르지 않습니다.');
  const binary = atob(base64);
  if (binary.length < 45 || binary.length > MAX_IMAGE_BYTES || btoa(binary) !== base64) fail('PNG 크기 또는 base64가 올바르지 않습니다.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0)), view = new DataView(bytes.buffer);
  if ([137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => bytes[index] !== value)) fail('PNG 서명이 올바르지 않습니다.');
  let position = 8, imageData = false, ended = false;
  while (position < bytes.length) {
    if (bytes.length - position < 12) fail('PNG 청크가 잘렸습니다.');
    const size = view.getUint32(position), end = position + 12 + size;
    if (end > bytes.length) fail('PNG 청크 크기가 올바르지 않습니다.');
    const type = String.fromCharCode(...bytes.subarray(position + 4, position + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || crc(bytes, position + 4, end - 4) !== view.getUint32(end - 4)) fail('PNG 청크 무결성 검사가 실패했습니다.');
    if (position === 8) {
      if (type !== 'IHDR' || size !== 13 || view.getUint32(16) !== entry.width || view.getUint32(20) !== entry.height) fail('PNG IHDR 크기가 메타데이터와 다릅니다.');
      const depths = {0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]};
      if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] || bytes[27] || bytes[28] > 1) fail('PNG IHDR 형식이 올바르지 않습니다.');
    } else if (type === 'IHDR') fail('PNG IHDR이 중복되었습니다.');
    if (type === 'IDAT' && size > 0) imageData = true;
    if (type === 'IEND') { if (size !== 0 || end !== bytes.length) fail('PNG 종료 청크가 올바르지 않습니다.'); ended = true; }
    position = end;
  }
  if (!imageData || !ended) fail('PNG 이미지 또는 종료 청크가 없습니다.');
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  if (actual !== entry.pngHash) fail('PNG SHA256이 일치하지 않습니다.');
  Object.freeze(entry.rect);
  return Object.freeze(entry);
}
export async function validatePack(raw, {extensionVersion = '0.1.0'} = {}) {
  const pack = parse(raw);
  keys(pack, ['format', 'schemaVersion', 'version', 'minimumExtensionVersion', 'texts', 'images']);
  if (pack.format !== 'tamacolle-kor-resources' || pack.schemaVersion !== 1) fail('지원하지 않는 파일 형식입니다.');
  versionParts(pack.version); versionParts(pack.minimumExtensionVersion); versionParts(extensionVersion);
  if (!Array.isArray(pack.texts) || pack.texts.length > 50000 || !Array.isArray(pack.images) || pack.images.length > 2000) fail('번역문 또는 PNG 개수 제한을 초과했습니다.');
  const sources = new Set(), imageKeys = new Set();
  for (const entry of pack.texts) {
    validateText(entry);
    if (sources.has(entry.source)) fail('중복 원문이 있습니다.');
    sources.add(entry.source);
  }
  for (const entry of pack.images) {
    await validateImage(entry);
    if (imageKeys.has(entry.key)) fail('중복 PNG 키가 있습니다.');
    imageKeys.add(entry.key);
  }
  if (compareVersions(pack.minimumExtensionVersion, extensionVersion) > 0) throw Object.assign(new Error(`확장 프로그램 ${pack.minimumExtensionVersion} 이상으로 업데이트해야 합니다.`), {code: 'REQUIRES_EXTENSION', version: pack.version, minimumExtensionVersion: pack.minimumExtensionVersion});
  Object.freeze(pack.texts); Object.freeze(pack.images);
  return Object.freeze(pack);
}
export function createTextIndex(pack) {
  const exact = new Map(), story = new Map();
  for (const entry of pack.texts) {
    exact.set(entry.source, entry);
    // As in the proven cache, the request context gates alias use, not the stored context.
    const key = dialogue.key(entry.source);
    if (!story.has(key)) story.set(key, entry);
  }
  return {exact, story};
}
export function lookupText(index, item) {
  if (!item || typeof item.id !== 'string' || item.id.length > 80 || typeof item.source !== 'string' || !item.source.trim() || item.source.length > 8192 || (item.context !== undefined && (typeof item.context !== 'string' || item.context.length > 300)) || (item.templates !== undefined && (!Array.isArray(item.templates) || item.templates.length > 8 || item.templates.some(source => typeof source !== 'string' || !source.trim() || source.length > 8192)))) throw new Error('번역 조회 요청이 올바르지 않습니다.');
  const candidates = [item.source, ...(item.templates || [])];
  let hit;
  for (const source of candidates) { hit = index.exact.get(source); if (hit) break; }
  if (!hit && dialogue.isStory(item.context)) for (const source of candidates) { hit = index.story.get(dialogue.key(source)); if (hit) break; }
  return hit ? {id: item.id, text: hit.text, cacheSource: hit.source} : null;
}
