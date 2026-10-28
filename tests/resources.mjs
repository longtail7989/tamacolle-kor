import {MAX_PACK_BYTES, compareVersions, validatePack, createTextIndex, lookupText} from '../resource-pack.mjs';
import {createResourceStore} from '../resource-store.mjs';
import {createGitHubUpdater} from '../github-release.mjs';

const equal = (actual, expected, message = '값이 다릅니다.') => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
};
const ok = (value, message = '조건을 만족하지 않습니다.') => { if (!value) throw new Error(message); };
async function rejects(action, pattern) {
  try { await action(); } catch (error) { if (pattern && !pattern.test(error.message)) throw error; return error; }
  throw new Error('오류로 거부되어야 합니다.');
}
const clone = value => structuredClone(value);
const basePack = (version = '1.0.0') => ({format: 'tamacolle-kor-resources', schemaVersion: 1, version, minimumExtensionVersion: '0.1.0', texts: [{source: '攻撃 10%\n{USER}', text: '{USER} 공격 10%\n', context: 'TamacolleDialogue'}], images: []});
const bytesOf = pack => new TextEncoder().encode(JSON.stringify(pack) + '\n');
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
const API = 'https://api.github.com/repos/longtail7989/tamacolle-kor/releases/latest';
const assetURL = version => `https://github.com/longtail7989/tamacolle-kor/releases/download/resource-v${version}/tamacolle-kor-resources.json`;
async function releaseFor(pack) {
  const bytes = bytesOf(pack);
  return {draft: false, prerelease: false, tag_name: `resource-v${pack.version}`, html_url: `https://github.com/longtail7989/tamacolle-kor/releases/tag/resource-v${pack.version}`, assets: [{name: 'tamacolle-kor-resources.json', browser_download_url: assetURL(pack.version), size: bytes.length, digest: `sha256:${await hash(bytes)}`} ]};
}
function server(release, bytes, {status = 200, assetResponse, metadataResponse} = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    if (url === API) return metadataResponse?.() || new Response(JSON.stringify(release), {status, headers: {'content-type': 'application/json'}});
    return assetResponse?.() || new Response(bytes);
  };
  return {fetchImpl, calls};
}
function updaterFor(fetchImpl, initial = basePack()) {
  let active = initial, applyCount = 0;
  const updater = createGitHubUpdater({fetchImpl, getCurrent: () => active, apply: async pack => { active = pack; applyCount++; }});
  return {updater, active: () => active, applyCount: () => applyCount};
}
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1; }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const bytes = new Uint8Array(12 + data.length), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length); bytes.set(new TextEncoder().encode(type), 4); bytes.set(data, 8);
  view.setUint32(bytes.length - 4, crc(bytes.subarray(4, bytes.length - 4)));
  return bytes;
}
async function imageFixture() {
  const {deflateSync} = await import('node:zlib');
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 6;
  const sections = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header), chunk('IDAT', deflateSync(Uint8Array.of(0, 255, 0, 0, 255))), chunk('IEND', new Uint8Array())];
  const bytes = new Uint8Array(sections.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of sections) { bytes.set(part, offset); offset += part.length; }
  return {key: 'fixture', name: '', uuid: '', sourcePath: '/games/tamacolle/res/fixture.png', rect: [0, 0, 1, 1], width: 1, height: 1, revision: 'ko-1', sourceHash: 'a'.repeat(64), sourcePixelHash: 'b'.repeat(64), translation: '테스트', sourceOrigin: 'https://nijitama.app', dataUrl: `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`, pngHash: await hash(bytes)};
}

// Transaction-controlled test double: deliberately separates request success and
// transaction commit. This does not substitute for the exported native-IDB suite.
function controlledIDB() {
  const databases = new Map();
  let failNextWrite = false, blockNextOpen = false;
  const events = [];
  const indexedDB = {
    open(name) {
      const request = {};
      queueMicrotask(() => {
        if (blockNextOpen) { blockNextOpen = false; request.onblocked?.(); return; }
        let record = databases.get(name), fresh = !record;
        if (fresh) { record = {stores: new Set(), active: undefined}; databases.set(name, record); }
        const db = {
          objectStoreNames: {contains: name => record.stores.has(name)},
          createObjectStore(name) { record.stores.add(name); },
          close() { events.push('close'); },
          transaction(name, mode) {
            const tx = {}, fail = mode === 'readwrite' && failNextWrite;
            if (mode === 'readwrite') failNextWrite = false;
            let aborted = false;
            tx.abort = () => { aborted = true; queueMicrotask(() => tx.onabort?.()); };
            tx.objectStore = () => ({
              get() { const request = {}; queueMicrotask(() => { request.result = clone(record.active); request.onsuccess?.(); setTimeout(() => tx.oncomplete?.(), 0); }); return request; },
              put(value) {
                const saved = clone(value), request = {};
                queueMicrotask(() => {
                  request.result = 'active'; events.push('request-success'); request.onsuccess?.();
                  setTimeout(() => {
                    if (aborted) return;
                    if (fail) { tx.error = new Error('quota'); events.push('abort'); tx.onabort?.(); }
                    else { record.active = saved; events.push('commit'); tx.oncomplete?.(); }
                  }, 0);
                });
                return request;
              }
            });
            return tx;
          }
        };
        request.result = db;
        if (fresh) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
  return {indexedDB, events, failWrite() { failNextWrite = true; }, blockOpen() { blockNextOpen = true; }};
}

/** Run from a real Chromium page/module context; the database is isolated and removed. */
export async function runNativeResourceStoreTests(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) throw new Error('이 검사는 실제 브라우저 IndexedDB가 필요합니다.');
  const dbName = `tam short-lived resource QA ${Date.now()}-${Math.random()}`;
  let store = createResourceStore({indexedDB, dbName});
  try {
    equal(await store.load(), null, '새 데이터베이스는 비어 있어야 합니다.');
    await store.save(basePack());
    await store.close();
    store = createResourceStore({indexedDB, dbName});
    equal(await store.load(), basePack(), '연결 재개 후에도 저장이 유지되어야 합니다.');
    await rejects(() => store.save({version: 'bad', uncloneable() {}}));
    equal(await store.load(), basePack(), '실패한 저장은 이전 활성 팩을 보존해야 합니다.');
    await Promise.all([store.save(basePack('1.1.0')), store.save(basePack('1.2.0'))]);
    equal((await store.load()).version, '1.2.0', '네이티브 쓰기 트랜잭션 순서를 지켜야 합니다.');
    await store.close();
    store = createResourceStore({indexedDB, dbName});
    equal((await store.load()).version, '1.2.0');
    return {passed: 5};
  } finally {
    await store.close();
    await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(dbName); request.onsuccess = resolve; request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('QA 데이터베이스 삭제가 차단되었습니다.')); });
  }
}

export async function runResourceTests() {
  const {test} = await import('node:test');
  const cases = [
    ['strict numeric semantic versions', async () => {
      equal(compareVersions('1.10.0', '1.2.99'), 1); equal(compareVersions('1.0.0', '1.0.0'), 0); equal(compareVersions('0.9.0', '1.0.0'), -1);
      equal(compareVersions('999999999999999999999999.0.0', '2.0.0'), 1);
      for (const version of ['v1.0.0', '01.0.0', '1.0', '1.0.0-beta', '1.0.0\n', '-1.0.0']) await rejects(() => compareVersions(version, '1.0.0'));
    }],
    ['JSON parser rejects duplicate keys, invalid UTF-8 and unknown/private fields', async () => {
      const valid = await validatePack(bytesOf(basePack())); equal(valid, basePack()); ok(Object.isFrozen(valid));
      await rejects(() => validatePack(JSON.stringify(basePack()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')), /중복/);
      await rejects(() => validatePack(JSON.stringify(basePack()).replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1')), /중복/);
      await rejects(() => validatePack(Uint8Array.of(0xff)), /UTF-8/);
      for (const change of [pack => { pack.apiKey = 'private'; }, pack => { pack.texts[0].id = 'private'; }, pack => { pack.texts[0].updatedAt = 10; }, pack => { pack.schemaVersion = 2; }, pack => { pack.texts[0].context = null; }]) {
        const pack = basePack(); change(pack); await rejects(() => validatePack(pack));
      }
      await rejects(() => validatePack('{broken JSON'));
    }],
    ['protected tokens preserve numbers, tags, variables, line endings and movable USER count', async () => {
      const pack = basePack();
      pack.texts = [{source: '<b>{USER}</b> +10.5%\r\n次', text: '<b></b> +10.5%\r\n{USER} 다음', context: ''}];
      await validatePack(pack);
      for (const text of ['<b>{USER}</b> +11.5%\r\n다음', '<b>{USER}</b> +10.5%\n다음', '<b>{USER}{USER}</b> +10.5%\r\n다음', '<b>{NAME}</b> +10.5%\r\n다음', '<b>{USER}</b> +10.5%\r\n다음 2', '</b>{USER}<b> +10.5%\r\n다음', '⟦CHECK_0⟧']) {
        const bad = clone(pack); bad.texts[0].text = text; await rejects(() => validatePack(bad));
      }
      const duplicate = basePack(); duplicate.texts.push(clone(duplicate.texts[0])); await rejects(() => validatePack(duplicate), /중복/);
    }],
    ['schema limits, required fields, and minimum extension are enforced', async () => {
      const pack = basePack(); pack.minimumExtensionVersion = '0.2.0';
      const error = await rejects(() => validatePack(pack)); equal(error.code, 'REQUIRES_EXTENSION'); equal(error.version, '1.0.0');
      equal((await validatePack(pack, {extensionVersion: '0.2.0'})).version, '1.0.0');
      for (const field of ['format', 'schemaVersion', 'version', 'minimumExtensionVersion', 'texts', 'images']) { const bad = basePack(); delete bad[field]; await rejects(() => validatePack(bad)); }
      const tooManyTexts = basePack(); tooManyTexts.texts = Array(50001).fill(tooManyTexts.texts[0]); await rejects(() => validatePack(tooManyTexts), /개수/);
      const tooManyImages = basePack(); tooManyImages.images = Array(2001).fill({}); await rejects(() => validatePack(tooManyImages), /개수/);
      await rejects(() => validatePack(new Uint8Array(MAX_PACK_BYTES + 1)), /32MiB/);
      const long = basePack(); long.texts[0].source = '字'.repeat(8193); await rejects(() => validatePack(long), /길이/);
    }],
    ['PNG metadata, SHA256, real chunks, geometry, and identity are validated', async () => {
      const pack = basePack(); pack.images.push(await imageFixture());
      const valid = await validatePack(pack); equal(valid.images[0], pack.images[0]);
      for (const change of [image => { image.pngHash = '0'.repeat(64); }, image => { image.sourcePixelHash = 'bad'; }, image => { image.width = 2; }, image => { image.rect[2] = 2; }, image => { image.dataUrl = image.dataUrl.replace('iVBOR', 'jVBOR'); }, image => { image.dataUrl += '='; }, image => { image.unknown = true; }, image => { image.sourceOrigin = 'javascript:alert(1)'; }, image => { image.asset = '../secrets.png'; }]) {
        const bad = clone(pack); change(bad.images[0]); await rejects(() => validatePack(bad));
      }
      const corrupted = clone(pack), binary = atob(corrupted.images[0].dataUrl.split(',')[1]), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      bytes[bytes.length - 1] ^= 1; corrupted.images[0].pngHash = await hash(bytes); corrupted.images[0].dataUrl = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
      await rejects(() => validatePack(corrupted), /청크/);
      const duplicate = clone(pack); duplicate.images.push(clone(pack.images[0])); await rejects(() => validatePack(duplicate), /중복/);
    }],
    ['lookup prioritizes exact then templates then story-only wrapper/newline aliases', async () => {
      const pack = basePack(); pack.texts = [{source: '原文', text: '원문', context: ''}, {source: '原\n文', text: '원\n문', context: 'TamacolleDialogue'}, {source: '{USER}さん', text: '{USER} 님', context: 'TamacolleSpeaker'}, {source: '<b>原文</b>', text: '<b>원문</b>', context: ''}];
      const index = createTextIndex(await validatePack(pack));
      equal(lookupText(index, {id: 'a', source: '原\n文', context: 'TamacolleDialogue'}), {id: 'a', text: '원\n문', cacheSource: '原\n文'});
      equal(lookupText(index, {id: 'b', source: '未登録', templates: ['{USER}さん'], context: ''}), {id: 'b', text: '{USER} 님', cacheSource: '{USER}さん'});
      equal(lookupText(index, {id: 'c', source: '<size=24>原\r\n文</size>', context: 'Scene / TamacolleBacklog'}), {id: 'c', text: '원문', cacheSource: '原文'});
      equal(lookupText(index, {id: 'd', source: '<size=24>原\r\n文</size>', context: 'UI'}), null);
      equal(lookupText(index, {id: 'e', source: '<b>原\n文</b>', context: 'TamacolleDialogue'}).cacheSource, '<b>原文</b>');
      equal(lookupText(index, {id: 'f', source: '原文', templates: ['{USER}さん'], context: 'TamacolleDialogue'}).cacheSource, '原文');
      await rejects(() => lookupText(index, {id: 'x', source: '原文', templates: Array(9).fill('原文')}));
    }],
    ['resource store resolves only at commit; abort preserves durable active record', async () => {
      const fake = controlledIDB(), options = {indexedDB: fake.indexedDB, dbName: 'unit'};
      let store = createResourceStore(options); equal(await store.load(), null);
      let resolved = false; const saving = store.save(basePack()).then(() => { resolved = true; });
      await new Promise(resolve => queueMicrotask(() => queueMicrotask(resolve)));
      equal(resolved, false); await saving; equal(fake.events.at(-1), 'commit');
      fake.failWrite(); await rejects(() => store.save(basePack('2.0.0')), /안전하게/); equal((await store.load()).version, '1.0.0');
      await store.close(); store = createResourceStore(options); equal((await store.load()).version, '1.0.0'); await store.close(); await rejects(() => store.load());
    }],
    ['resource store recovers from failed opens and rejects uncloneable writes', async () => {
      const fake = controlledIDB(); fake.blockOpen();
      const store = createResourceStore({indexedDB: fake.indexedDB}); await rejects(() => store.load());
      await store.save(basePack()); await rejects(() => store.save({bad() {}})); equal((await store.load()).version, '1.0.0'); await store.close();
    }],
    ['GitHub update is single-flight, credential-free, digest-checked and applied once', async () => {
      const next = basePack('1.1.0'), release = await releaseFor(next), network = server(release, bytesOf(next));
      const harness = updaterFor(network.fetchImpl), first = harness.updater.checkAndUpdate(), second = harness.updater.checkAndUpdate();
      ok(first === second, '동시 검사는 같은 Promise를 공유해야 합니다.');
      equal((await first).status, 'updated'); equal(harness.active().version, '1.1.0'); equal(harness.applyCount(), 1); equal(network.calls.length, 2);
      equal(network.calls[0].url, API); equal(network.calls[1].url, assetURL('1.1.0'));
      for (const call of network.calls) { equal(call.options.credentials, 'omit'); equal(call.options.cache, 'no-store'); ok(call.options.signal instanceof AbortSignal); }
      equal(network.calls[0].options.redirect, 'error'); equal(network.calls[1].options.redirect, 'follow');
      equal((await harness.updater.checkAndUpdate()).status, 'current'); equal(network.calls.length, 3, '동일 버전은 JSON을 다운로드하지 않아야 합니다.'); equal(harness.applyCount(), 1);
    }],
    ['GitHub current release digest mismatch rejects without downloading', async () => {
      const pack = basePack(), release = await releaseFor(pack); release.assets[0].digest = `sha256:${'0'.repeat(64)}`;
      const network = server(release, bytesOf(pack)), harness = updaterFor(network.fetchImpl);
      await rejects(() => harness.updater.checkAndUpdate(), /같은 버전/); equal(network.calls.length, 1); equal(harness.applyCount(), 0);
    }],
    ['unpublished 404 and draft/prerelease do not fetch or apply resources', async () => {
      for (const configuration of [{status: 404}, {draft: true}, {prerelease: true}]) {
        const release = {...await releaseFor(basePack('1.1.0')), ...configuration}, network = server(release, new Uint8Array(), configuration);
        const harness = updaterFor(network.fetchImpl); equal((await harness.updater.checkAndUpdate()).status, 'unpublished'); equal(network.calls.length, 1); equal(harness.applyCount(), 0);
      }
    }],
    ['unsafe release URLs, missing digest, invalid tag, oversized asset and downgrade fail closed', async () => {
      const next = basePack('1.1.0');
      for (const change of [release => { release.assets[0].browser_download_url = 'https://evil.example/resources.json'; }, release => { release.assets[0].browser_download_url = assetURL('1.1.0') + '?evil=1'; }, release => { delete release.assets[0].digest; }, release => { release.assets[0].size = MAX_PACK_BYTES + 1; }, release => { release.tag_name = 'v1.1.0'; }, release => { release.html_url = 'https://evil.example/release'; }, release => { release.assets.push(clone(release.assets[0])); }]) {
        const release = await releaseFor(next); change(release); const network = server(release, bytesOf(next)), harness = updaterFor(network.fetchImpl);
        await rejects(() => harness.updater.checkAndUpdate()); equal(network.calls.length, 1); equal(harness.applyCount(), 0);
      }
      const old = basePack('0.9.0'), network = server(await releaseFor(old), bytesOf(old)), harness = updaterFor(network.fetchImpl);
      await rejects(() => harness.updater.checkAndUpdate(), /이전 버전/); equal(network.calls.length, 1);
    }],
    ['minimum app version returns requires-extension only after full integrity/schema checks', async () => {
      const next = basePack('1.1.0'); next.minimumExtensionVersion = '0.2.0';
      const network = server(await releaseFor(next), bytesOf(next)), harness = updaterFor(network.fetchImpl);
      equal((await harness.updater.checkAndUpdate()).status, 'requires-extension'); equal(harness.applyCount(), 0); equal(harness.active().version, '1.0.0');
      next.texts[0].text = '숫자 누락'; const invalid = server(await releaseFor(next), bytesOf(next)), invalidHarness = updaterFor(invalid.fetchImpl);
      await rejects(() => invalidHarness.updater.checkAndUpdate(), /일치하지/); equal(invalidHarness.applyCount(), 0);
    }],
    ['digest, size, truncated stream, invalid pack and mismatched tag cannot activate partial data', async () => {
      const next = basePack('1.1.0');
      for (const mode of ['digest', 'length', 'truncated', 'oversized-header', 'invalid-pack', 'tag']) {
        let bytes = bytesOf(next), release = await releaseFor(next), assetResponse;
        if (mode === 'digest') bytes = bytesOf(basePack('1.2.0'));
        if (mode === 'length') release.assets[0].size--;
        if (mode === 'truncated') bytes = bytes.slice(0, bytes.length - 1);
        if (mode === 'oversized-header') assetResponse = () => new Response(bytes, {headers: {'content-length': String(MAX_PACK_BYTES + 1)}});
        if (mode === 'invalid-pack') { const bad = clone(next); bad.texts[0].text = '10'; bytes = bytesOf(bad); release = await releaseFor(bad); }
        if (mode === 'tag') { const other = basePack('1.2.0'); bytes = bytesOf(other); release.assets[0].size = bytes.length; release.assets[0].digest = `sha256:${await hash(bytes)}`; }
        const network = server(release, bytes, {assetResponse}), harness = updaterFor(network.fetchImpl);
        await rejects(() => harness.updater.checkAndUpdate()); equal(harness.applyCount(), 0); equal(harness.active().version, '1.0.0');
      }
    }],
    ['stream reader enforces size without Content-Length and cancels early', async () => {
      const next = basePack('1.1.0'), release = await releaseFor(next); let canceled = false;
      const network = server(release, null, {assetResponse: () => new Response(new ReadableStream({start(controller) { controller.enqueue(new Uint8Array(release.assets[0].size + 1)); }, cancel() { canceled = true; }}))});
      const harness = updaterFor(network.fetchImpl); await rejects(() => harness.updater.checkAndUpdate(), /크기 제한/); ok(canceled); equal(harness.applyCount(), 0);
    }],
    ['network and durable apply failures reject and clear single-flight for retry', async () => {
      const next = basePack('1.1.0'), release = await releaseFor(next); let fail = true;
      const network = server(release, bytesOf(next));
      const harness = updaterFor(async (...args) => { if (fail) { fail = false; throw new Error('offline'); } return network.fetchImpl(...args); });
      await rejects(() => harness.updater.checkAndUpdate(), /네트워크/); equal((await harness.updater.checkAndUpdate()).status, 'updated');
      let active = basePack(); const failedApply = createGitHubUpdater({fetchImpl: network.fetchImpl, getCurrent: () => active, apply: async () => { throw new Error('disk full'); }});
      await rejects(() => failedApply.checkAndUpdate(), /기존 리소스/); equal(active.version, '1.0.0');
    }],
    ['timeouts abort stalled downloads, retain active data, and release single-flight', async () => {
      const originalSetTimeout = globalThis.setTimeout;
      const originalClearTimeout = globalThis.clearTimeout;
      const timer = {};
      let signal;
      globalThis.setTimeout = (callback, delay, ...args) => {
        if (delay === 30000) { queueMicrotask(callback); return timer; }
        return originalSetTimeout(callback, delay, ...args);
      };
      globalThis.clearTimeout = handle => { if (handle !== timer) originalClearTimeout(handle); };
      try {
        const harness = updaterFor(async (_, options) => { signal = options.signal; return new Promise(() => {}); });
        await rejects(() => harness.updater.checkAndUpdate(), /시간이 초과/);
        ok(signal.aborted); equal(harness.applyCount(), 0); equal(harness.active().version, '1.0.0');
      } finally { globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; }
    }],
    ['GitHub errors and unexpected final redirect hosts reject without activation', async () => {
      const next = basePack('1.1.0'), release = await releaseFor(next);
      const failedAPI = server(release, bytesOf(next), {status: 403}), apiHarness = updaterFor(failedAPI.fetchImpl);
      await rejects(() => apiHarness.updater.checkAndUpdate(), /HTTP 403/); equal(failedAPI.calls.length, 1);
      for (const finalURL of ['https://evil.example/asset', 'http://release-assets.githubusercontent.com/asset', 'https://release-assets.githubusercontent.com.evil.example/asset']) {
        const network = server(release, null, {assetResponse: () => {
          const response = new Response(bytesOf(next));
          Object.defineProperty(response, 'url', {value: finalURL});
          return response;
        }});
        const harness = updaterFor(network.fetchImpl); await rejects(() => harness.updater.checkAndUpdate(), /리디렉션/); equal(harness.applyCount(), 0);
      }
      const network = server(release, null, {assetResponse: () => {
        const response = new Response(bytesOf(next));
        Object.defineProperty(response, 'url', {value: 'https://release-assets.githubusercontent.com/github-production-release-asset/fixture?signature=public'});
        return response;
      }});
      equal((await updaterFor(network.fetchImpl).updater.checkAndUpdate()).status, 'updated');
    }],
  ];
  for (const [name, action] of cases) await test(name, action);
}

if (typeof process !== 'undefined' && process.versions?.node) {
  const {pathToFileURL} = await import('node:url');
  if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await runResourceTests();
}
