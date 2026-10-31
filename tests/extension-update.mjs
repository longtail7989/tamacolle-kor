import {createExtensionUpdater} from '../extension-release.mjs';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const equal = (actual, expected, message = '값이 다릅니다.') => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
};
async function rejects(action, pattern) {
  try { await action(); } catch (error) { if (pattern && !pattern.test(error.message)) throw error; return error; }
  throw new Error('오류로 거부되어야 합니다.');
}
const API = 'https://api.github.com/repos/longtail7989/tamacolle-kor/releases/latest';
const RELEASES = 'https://github.com/longtail7989/tamacolle-kor/releases';
const TAG = 'resource-v1.0.2';
const RELEASE = `${RELEASES}/tag/${TAG}`;
const asset = (version = '0.1.2', kind = 'zip') => {
  const name = `tamacolle-kor-${version}-extension.${kind}`;
  return {name, browser_download_url: `${RELEASES}/download/${TAG}/${name}`, size: 1024};
};
const DOWNLOAD = asset().browser_download_url;
const CRX_DOWNLOAD = asset('0.1.2', 'crx').browser_download_url;
const release = (assets = [asset()]) => ({
  draft: false, prerelease: false, tag_name: TAG, html_url: RELEASE,
  assets: [{name: 'tamacolle-kor-resources.json', browser_download_url: `${RELEASES}/download/${TAG}/tamacolle-kor-resources.json`, size: 10}, ...assets]
});
function server(value, {status = 200, url} = {}) {
  return async (requested) => {
    equal(requested, API, '릴리스 API만 요청해야 합니다.');
    const response = new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});
    if (url) Object.defineProperty(response, 'url', {value: url});
    return response;
  };
}
const tests = [
  ['reports a newer published PC ZIP with its official URL', async () => {
    const result = await createExtensionUpdater({fetchImpl: server(release()), currentVersion: '0.1.1'}).check();
    equal(result, {status: 'available', latest: '0.1.2', url: DOWNLOAD, crxUrl: null, releaseUrl: RELEASE});
  }],
  ['supports CRX-only releases and paired files in either order', async () => {
    for (const assets of [[asset('0.1.2', 'crx')], [asset(), asset('0.1.2', 'crx')], [asset('0.1.2', 'crx'), asset()]]) {
      const result = await createExtensionUpdater({fetchImpl: server(release(assets)), currentVersion: '0.1.1'}).check();
      equal(result, {status: 'available', latest: '0.1.2', url: assets.length === 1 ? null : DOWNLOAD, crxUrl: CRX_DOWNLOAD, releaseUrl: RELEASE});
    }
  }],
  ['selects the semantic maximum without mixing package versions', async () => {
    for (const kind of ['zip', 'crx']) {
      const newest = asset('0.10.0', kind), older = asset('0.9.0', kind === 'zip' ? 'crx' : 'zip');
      for (const assets of [[newest, older], [older, newest]]) {
        const result = await createExtensionUpdater({fetchImpl: server(release(assets)), currentVersion: '0.1.1'}).check();
        equal(result, {status: 'available', latest: '0.10.0', url: kind === 'zip' ? newest.browser_download_url : null, crxUrl: kind === 'crx' ? newest.browser_download_url : null, releaseUrl: RELEASE});
      }
    }
  }],
  ['same or older versions suppress both download URLs', async () => {
    for (const assets of [[asset()], [asset('0.1.2', 'crx')], [asset(), asset('0.1.2', 'crx')]]) {
      for (const currentVersion of ['0.1.2', '0.2.0']) {
        equal(await createExtensionUpdater({fetchImpl: server(release(assets)), currentVersion}).check(), {status: 'current', latest: '0.1.2', url: null, crxUrl: null, releaseUrl: RELEASE});
      }
    }
  }],
  ['unpublished and absent packages stay silent', async () => {
    const silent = {status: 'unpublished', latest: '', url: null, crxUrl: null};
    equal(await createExtensionUpdater({fetchImpl: server({}, {status: 404}), currentVersion: '0.1.1'}).check(), silent);
    equal(await createExtensionUpdater({fetchImpl: server(release([])), currentVersion: '0.1.1'}).check(), silent);
    for (const field of ['draft', 'prerelease']) {
      const hidden = release(); hidden[field] = true;
      equal(await createExtensionUpdater({fetchImpl: server(hidden), currentVersion: '0.1.1'}).check(), silent);
    }
    for (const name of ['tamacolle-kor-01.2.0-extension.crx', 'tamacolle-kor-0.1.2-extension.crx.exe', '../tamacolle-kor-0.1.2-extension.crx']) {
      equal(await createExtensionUpdater({fetchImpl: server(release([{...asset('0.1.2', 'crx'), name}])), currentVersion: '0.1.1'}).check(), silent);
    }
  }],
  ['wrong release tag and release URL fail closed', async () => {
    for (const change of [value => { value.tag_name = 'v1.0.2'; }, value => { value.html_url = 'https://evil.example/release'; }]) {
      const value = release(); change(value);
      await rejects(() => createExtensionUpdater({fetchImpl: server(value), currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
    }
    await rejects(() => createExtensionUpdater({fetchImpl: server(release(), {url: 'https://evil.example/api'}), currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
  }],
  ['both file kinds reject unsafe hosts, filenames, tags and sizes', async () => {
    for (const kind of ['zip', 'crx']) {
      for (const change of [
        value => { value.browser_download_url = 'https://evil.example/file'; },
        value => { value.browser_download_url += '?download=1'; },
        value => { value.browser_download_url = value.browser_download_url.replace(TAG, 'resource-v9.9.9'); },
        value => { value.browser_download_url = value.browser_download_url.replace('-extension.', '-other.'); },
        ...[0, -1, 1.5, '1024', 64 * 1024 * 1024 + 1].map(size => value => { value.size = size; })
      ]) {
        const value = asset('0.1.2', kind); change(value);
        await rejects(() => createExtensionUpdater({fetchImpl: server(release([value])), currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
      }
    }
    const unsafeOlder = asset('0.1.1', 'crx'); unsafeOlder.browser_download_url = 'https://evil.example/file';
    await rejects(() => createExtensionUpdater({fetchImpl: server(release([asset(), unsafeOlder])), currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
  }],
  ['malformed and failed responses fail closed', async () => {
    await rejects(() => createExtensionUpdater({fetchImpl: async () => new Response('{', {status: 200}), currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
    await rejects(() => createExtensionUpdater({fetchImpl: server(release(), {status: 500}), currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
    await rejects(() => createExtensionUpdater({fetchImpl: async () => { throw new Error('offline'); }, currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
  }],
  ['concurrent checks share one request and a later check starts fresh', async () => {
    let calls = 0;
    const updater = createExtensionUpdater({fetchImpl: async requested => { calls++; return server(release([asset(), asset('0.1.2', 'crx')]))(requested); }, currentVersion: '0.1.1'});
    const first = updater.check(), second = updater.check();
    equal(first === second, true);
    const [a, b] = await Promise.all([first, second]);
    equal(calls, 1); equal(a, b); equal(a.crxUrl, CRX_DOWNLOAD);
    await updater.check(); equal(calls, 2);
  }]
];

let backgroundSerial = 0;
async function withBackground(action) {
  const originals = new Map(['chrome', 'fetch', 'indexedDB'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const event = () => ({addListener(listener) { this.listener = listener; }});
  const saved = {resourceKnown: true, resourceLatest: '1.0.0', lastChecked: Date.now(), extensionKnown: true, extensionLatest: '', extensionChecked: Date.now()};
  const pack = {format: 'tamacolle-kor-resources', schemaVersion: 1, version: '1.0.0', minimumExtensionVersion: '0.1.0', texts: [], images: []};
  async function start(value = release(), currentVersion = '0.1.1') {
    let requests = 0;
    const chrome = {
      runtime: {id: 'test-extension', getManifest: () => ({version: currentVersion}), getURL: path => `chrome-extension://test-extension/${path}`, onMessage: event(), onConnect: event(), onInstalled: event(), onStartup: event()},
      storage: {local: {async get(defaults) { return {...defaults, ...saved}; }, async set(values) { Object.assign(saved, structuredClone(values)); }}},
      action: {async setBadgeText() {}, async setTitle() {}},
      alarms: {onAlarm: event(), create() {}}
    };
    globalThis.chrome = chrome;
    globalThis.fetch = async url => {
      if (url === chrome.runtime.getURL('resources/ko.json')) return new Response(JSON.stringify(pack));
      requests++; return server(value)(url);
    };
    // Empty resource store: extension download links use chrome.storage.local,
    // independently of the IndexedDB-backed translation pack.
    globalThis.indexedDB = {open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {transaction() {
          const transaction = {objectStore: () => ({get() {
            const result = {};
            queueMicrotask(() => { result.onsuccess(); queueMicrotask(() => transaction.oncomplete()); });
            return result;
          }})};
          return transaction;
        }};
        request.onsuccess();
      });
      return request;
    }};
    await import(`../background.mjs?extension-update-test=${++backgroundSerial}`);
    const sender = {id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html')};
    const request = (type, from = sender) => new Promise(resolve => chrome.runtime.onMessage.listener({type}, from, resolve));
    return {request, requests: () => requests};
  }
  try { await action({start, saved}); }
  finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

tests.push(
  ['CRX link persists through a background restart and disappears after updating the app', async () => {
    await withBackground(async ({start, saved}) => {
      const first = await start(release([asset(), asset('0.1.2', 'crx')]));
      const checked = await first.request('CHECK_EXTENSION');
      equal(checked.ok, true); equal(checked.state.extension.crxUrl, CRX_DOWNLOAD);
      equal(saved.extensionCrxUrl, CRX_DOWNLOAD);
      const restarted = await start();
      const restored = (await restarted.request('GET_STATE')).state.extension;
      equal(restored.available, true); equal(restored.url, DOWNLOAD); equal(restored.crxUrl, CRX_DOWNLOAD);
      equal(restarted.requests(), 0);
      const updated = await start(release(), '0.1.2');
      const current = (await updated.request('GET_STATE')).state.extension;
      equal(current.available, false); equal(current.crxUrl, null);
    });
  }],
  ['required minimum never reuses an older package and retains the official Release fallback', async () => {
    await withBackground(async ({start, saved}) => {
      Object.assign(saved, {extensionLatest: '0.1.2', extensionUrl: DOWNLOAD, extensionCrxUrl: CRX_DOWNLOAD, extensionRequired: '0.1.3'});
      const background = await start();
      const notice = (await background.request('GET_STATE')).state.extension;
      equal(notice.target, '0.1.3'); equal(notice.available, true);
      equal(notice.url, RELEASES); equal(notice.crxUrl, null);
    });
  }],
  ['old storage has no CRX link and unsafe or mismatched saved links are discarded', async () => {
    await withBackground(async ({start, saved}) => {
      Object.assign(saved, {extensionLatest: '0.1.2', extensionUrl: DOWNLOAD});
      const old = await start();
      equal((await old.request('GET_STATE')).state.extension.crxUrl, null);
      for (const value of ['https://evil.example/file.crx', asset('0.1.3', 'crx').browser_download_url, CRX_DOWNLOAD.replace(TAG, 'resource-v01.0.2'), CRX_DOWNLOAD.replace('.crx', '.zip')]) {
        saved.extensionCrxUrl = value;
        const restarted = await start();
        const notice = (await restarted.request('GET_STATE')).state.extension;
        equal(notice.url, DOWNLOAD); equal(notice.crxUrl, null);
      }
    });
  }],
  ['background CRX-only availability survives storage and preserves popup sender validation', async () => {
    await withBackground(async ({start}) => {
      const first = await start(release([asset('0.1.2', 'crx')]));
      equal((await first.request('CHECK_EXTENSION', {id: 'other', url: 'https://evil.example/popup.html'})).ok, false);
      const checked = await first.request('CHECK_EXTENSION');
      equal(checked.state.extension.url, RELEASES); equal(checked.state.extension.crxUrl, CRX_DOWNLOAD);
      const restarted = await start();
      const restored = (await restarted.request('GET_STATE')).state.extension;
      equal(restored.available, true); equal(restored.url, RELEASES); equal(restored.crxUrl, CRX_DOWNLOAD);
    });
  }]
);


for (const [name, action] of tests) await test(name, action);
